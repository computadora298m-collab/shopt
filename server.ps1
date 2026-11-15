param(
    [int]$Port = 8000,
    [switch]$AllowNetwork
)

$ErrorActionPreference = 'Stop'
$baseDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$databasePath = Join-Path $baseDirectory 'tienda-data.json'
$sharedStorageKeys = @('users_v1', 'products_v1', 'orders_v1', 'archived_orders_v1', 'site_config_v1')
$listener = New-Object System.Net.HttpListener
if ($AllowNetwork) {
    $listener.Prefixes.Add("http://*:$Port/")
} else {
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
}

function Write-Response {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$StatusCode,
        [string]$ContentType,
        [string]$Body
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = $ContentType
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Write-JsonResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$StatusCode,
        [hashtable]$Data
    )

    $body = ConvertTo-Json -InputObject $Data -Depth 30 -Compress
    Write-Response -Response $Response -StatusCode $StatusCode -ContentType 'application/json; charset=utf-8' -Body $body
}

function Invoke-DataRequest {
    param([System.Net.HttpListenerContext]$Context)

    if ($Context.Request.HttpMethod -eq 'GET') {
        if (Test-Path -LiteralPath $databasePath) {
            $database = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($databasePath, [System.Text.Encoding]::UTF8))
            if ($null -eq $database.values) {
                throw 'El archivo de datos de la tienda no contiene el objeto values.'
            }
            $values = $database.values
        } else {
            $values = @{}
        }
        Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ values = $values }
        return
    }

    if ($Context.Request.HttpMethod -ne 'PUT') {
        Write-JsonResponse -Response $Context.Response -StatusCode 405 -Data @{ error = 'Método no permitido.' }
        return
    }
    if ($Context.Request.ContentLength64 -gt 8388608) {
        Write-JsonResponse -Response $Context.Response -StatusCode 413 -Data @{ error = 'Los datos enviados superan el límite permitido.' }
        return
    }
    if ($Context.Request.ContentType -notlike 'application/json*') {
        Write-JsonResponse -Response $Context.Response -StatusCode 415 -Data @{ error = 'El formato de la solicitud no es válido.' }
        return
    }

    $reader = New-Object -TypeName System.IO.StreamReader -ArgumentList @($Context.Request.InputStream, $Context.Request.ContentEncoding)
    try {
        $requestData = ConvertFrom-Json -InputObject $reader.ReadToEnd()
    } catch {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'No se pudieron leer los datos enviados.' }
        return
    } finally {
        $reader.Dispose()
    }

    if ($requestData.key -isnot [string] -or $sharedStorageKeys -notcontains $requestData.key -or $requestData.value -isnot [string]) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La clave o el valor enviado no son válidos.' }
        return
    }

    if (Test-Path -LiteralPath $databasePath) {
        $database = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($databasePath, [System.Text.Encoding]::UTF8))
        if ($null -eq $database.values) {
            throw 'El archivo de datos de la tienda no contiene el objeto values.'
        }
        $values = $database.values
    } else {
        $database = [PSCustomObject]@{ values = [PSCustomObject]@{} }
        $values = $database.values
    }

    $values | Add-Member -MemberType NoteProperty -Name $requestData.key -Value $requestData.value -Force
    $temporaryPath = "$databasePath.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $json = ConvertTo-Json -InputObject $database -Depth 30
        [System.IO.File]::WriteAllText($temporaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $databasePath) {
            [System.IO.File]::Replace($temporaryPath, $databasePath, $null)
        } else {
            [System.IO.File]::Move($temporaryPath, $databasePath)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }

    Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ saved = $true }
}

function Invoke-GeminiRequest {
    param([System.Net.HttpListenerContext]$Context)

    if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 503 -Data @{
            error = 'Falta configurar GEMINI_API_KEY. Sigue los pasos de README.md y reinicia el servidor.'
        }
        return
    }

    if ($Context.Request.ContentLength64 -gt 32768) {
        Write-JsonResponse -Response $Context.Response -StatusCode 413 -Data @{ error = 'La consulta es demasiado grande.' }
        return
    }

    if ($Context.Request.ContentType -notlike 'application/json*') {
        Write-JsonResponse -Response $Context.Response -StatusCode 415 -Data @{ error = 'El formato de la solicitud no es válido.' }
        return
    }

    $reader = New-Object -TypeName System.IO.StreamReader -ArgumentList @($Context.Request.InputStream, $Context.Request.ContentEncoding)
    try {
        $requestData = ConvertFrom-Json -InputObject $reader.ReadToEnd()
    } catch {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'No se pudo leer el mensaje enviado.' }
        return
    } finally {
        $reader.Dispose()
    }

    if ($requestData.message -isnot [string] -or [string]::IsNullOrWhiteSpace($requestData.message) -or $requestData.message.Length -gt 2000) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'Escribe una pregunta de hasta 2000 caracteres.' }
        return
    }

    if ($requestData.siteName -isnot [string] -or $requestData.siteName.Length -gt 120) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La configuración de la tienda no es válida.' }
        return
    }

    $products = @($requestData.products)
    if ($products.Count -gt 100) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El catálogo enviado supera el límite permitido.' }
        return
    }

    $catalogLines = @(
        foreach ($product in $products) {
            if ($product.name -is [string]) {
                $description = if ($product.description -is [string]) { $product.description } else { '' }
                "- $($product.name) (`$$($product.price)): $description (Stock: $($product.stock))"
            }
        }
    )
    $catalog = if ($catalogLines.Count -gt 0) { $catalogLines -join "`n" } else { 'No hay productos disponibles.' }
    $prompt = "Catálogo de la tienda $($requestData.siteName):`n$catalog`n`nPregunta del cliente: $($requestData.message)"

    $payload = @{
        contents = @(
            @{
                parts = @(@{ text = $prompt })
            }
        )
        systemInstruction = @{
            parts = @(
                @{
                    text = "Eres el asistente de compras de $($requestData.siteName). Responde en español, de forma amable y concisa. Recomienda únicamente productos que aparezcan en el catálogo. No inventes precios ni disponibilidad."
                }
            )
        }
        generationConfig = @{
            maxOutputTokens = 500
            temperature = 0.6
        }
    }
    $jsonPayload = ConvertTo-Json -InputObject $payload -Depth 10 -Compress

    try {
        $geminiResponse = Invoke-RestMethod `
            -Uri 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent' `
            -Method Post `
            -Headers @{ 'x-goog-api-key' = $env:GEMINI_API_KEY } `
            -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonPayload)) `
            -TimeoutSec 45 `
            -UseBasicParsing

        $answer = @($geminiResponse.candidates[0].content.parts | ForEach-Object { $_.text }) -join "`n"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            Write-JsonResponse -Response $Context.Response -StatusCode 502 -Data @{ error = 'Gemini no devolvió una respuesta. Inténtalo de nuevo.' }
            return
        }

        Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ text = $answer }
    } catch {
        $providerStatus = 0
        if ($_.Exception.Response) {
            $providerStatus = [int]$_.Exception.Response.StatusCode
        }

        if ($providerStatus -eq 401 -or $providerStatus -eq 403) {
            $message = 'Gemini rechazó la clave. Comprueba que GEMINI_API_KEY sea válida y tenga acceso a la API.'
        } elseif ($providerStatus -eq 429) {
            $message = 'Se alcanzó el límite de consultas de Gemini. Espera un momento e inténtalo de nuevo.'
        } else {
            $message = 'No se pudo conectar con Gemini. Comprueba tu conexión e inténtalo de nuevo.'
        }
        Write-Warning "Gemini request failed with HTTP status $providerStatus."
        Write-JsonResponse -Response $Context.Response -StatusCode 502 -Data @{ error = $message }
    }
}

try {
    try {
        $listener.Start()
    } catch {
        if ($AllowNetwork -and $_.Exception -is [System.Net.HttpListenerException]) {
            $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
            throw "Windows requiere reservar el puerto para acceso de red. Abre PowerShell como administrador y ejecuta: netsh http add urlacl url=http://*:$Port/ user=$identity"
        }
        throw
    }

    Write-Host "Tienda disponible en http://127.0.0.1:$Port/indexl.html"
    if ($AllowNetwork) {
        $addresses = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and -not [System.Net.IPAddress]::IsLoopback($_) }
        foreach ($address in $addresses) {
            Write-Host "Acceso desde otros dispositivos: http://$($address.IPAddressToString):$Port/indexl.html"
        }
        Write-Warning 'El acceso por red comparte los datos en la red local. Úsalo solo en una red privada y confiable.'
    }
    Write-Host 'Presiona Ctrl+C para detener el servidor.'

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $path = $context.Request.Url.AbsolutePath

            if ($path -eq '/api/data') {
                Invoke-DataRequest -Context $context
            } elseif ($path -eq '/api/gemini') {
                if ($context.Request.HttpMethod -ne 'POST') {
                    Write-JsonResponse -Response $context.Response -StatusCode 405 -Data @{ error = 'Método no permitido.' }
                } else {
                    Invoke-GeminiRequest -Context $context
                }
            } elseif (($path -eq '/' -or $path -eq '/indexl.html') -and $context.Request.HttpMethod -eq 'GET') {
                $htmlPath = Join-Path $baseDirectory 'indexl.html'
                $html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
                Write-Response -Response $context.Response -StatusCode 200 -ContentType 'text/html; charset=utf-8' -Body $html
            } else {
                Write-Response -Response $context.Response -StatusCode 404 -ContentType 'text/plain; charset=utf-8' -Body 'No encontrado.'
            }
        } catch {
            Write-Error "Request failed: $($_.Exception.Message)"
            try {
                Write-JsonResponse -Response $context.Response -StatusCode 500 -Data @{ error = 'Ocurrió un error en el servidor local.' }
            } catch {
                Write-Warning 'Could not send an error response to the client.'
            }
        } finally {
            $context.Response.Close()
        }
    }
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
