param(
    [int]$Port = 8000,
    [switch]$AllowNetwork
)

$ErrorActionPreference = 'Stop'
$baseDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$databasePath = Join-Path $baseDirectory 'tienda-data.json'
$assistantInstructionsPath = Join-Path $baseDirectory 'assistant-instructions.txt'
$assistantCasesPath = Join-Path $baseDirectory 'assistant-cases.json'
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

function Read-Database {
    if (-not (Test-Path -LiteralPath $databasePath)) {
        return [PSCustomObject]@{ values = [PSCustomObject]@{} }
    }

    $database = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($databasePath, [System.Text.Encoding]::UTF8))
    if ($null -eq $database.values) {
        throw 'El archivo de datos de la tienda no contiene el objeto values.'
    }
    return $database
}

function Save-Database {
    param([object]$Database)

    $temporaryPath = "$databasePath.$([Guid]::NewGuid().ToString('N')).tmp"
    $backupPath = "$temporaryPath.bak"
    try {
        $json = ConvertTo-Json -InputObject $Database -Depth 30
        [System.IO.File]::WriteAllText($temporaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $databasePath) {
            [System.IO.File]::Replace($temporaryPath, $databasePath, $backupPath)
        } else {
            [System.IO.File]::Move($temporaryPath, $databasePath)
        }
    } finally {
        foreach ($pathToClean in @($temporaryPath, $backupPath)) {
            if (Test-Path -LiteralPath $pathToClean) {
                Remove-Item -LiteralPath $pathToClean -Force
            }
        }
    }
}

function Read-JsonRequestBody {
    param(
        [System.Net.HttpListenerContext]$Context,
        [long]$MaximumBytes
    )

    if ($Context.Request.ContentLength64 -gt $MaximumBytes) {
        Write-JsonResponse -Response $Context.Response -StatusCode 413 -Data @{ error = 'Los datos enviados superan el límite permitido.' }
        return $null
    }
    if ($Context.Request.ContentType -notlike 'application/json*') {
        Write-JsonResponse -Response $Context.Response -StatusCode 415 -Data @{ error = 'El formato de la solicitud no es válido.' }
        return $null
    }

    $reader = New-Object -TypeName System.IO.StreamReader -ArgumentList @($Context.Request.InputStream, $Context.Request.ContentEncoding)
    try {
        $requestData = ConvertFrom-Json -InputObject $reader.ReadToEnd()
    } catch {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'No se pudieron leer los datos enviados.' }
        return $null
    } finally {
        $reader.Dispose()
    }

    if ($null -eq $requestData -or $requestData -isnot [PSCustomObject]) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El contenido enviado no es válido.' }
        return $null
    }
    return $requestData
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
    Save-Database -Database $database
    Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ saved = $true }
}

function Invoke-GoogleAuthRequest {
    param([System.Net.HttpListenerContext]$Context)

    if ($Context.Request.HttpMethod -ne 'POST') {
        Write-JsonResponse -Response $Context.Response -StatusCode 405 -Data @{ error = 'Método no permitido.' }
        return
    }

    $requestData = Read-JsonRequestBody -Context $Context -MaximumBytes 16384
    if ($null -eq $requestData) { return }
    if ($requestData.credential -isnot [string] -or $requestData.credential.Length -gt 12000) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La credencial de Google no es válida.' }
        return
    }

    $database = Read-Database
    $values = $database.values
    $siteConfigJson = $values.site_config_v1
    if ($siteConfigJson -isnot [string]) {
        Write-JsonResponse -Response $Context.Response -StatusCode 503 -Data @{ error = 'El inicio con Google todavía no está habilitado para esta tienda.' }
        return
    }
    $siteConfig = ConvertFrom-Json -InputObject $siteConfigJson
    $clientId = [string]$siteConfig.googleClientId
    if ([string]::IsNullOrWhiteSpace($clientId)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 503 -Data @{ error = 'El inicio con Google todavía no está habilitado para esta tienda.' }
        return
    }

    try {
        $tokenInfoUri = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + [uri]::EscapeDataString($requestData.credential)
        $googleUser = Invoke-RestMethod -Uri $tokenInfoUri -Method Get -TimeoutSec 20 -UseBasicParsing
    } catch {
        Write-Warning 'Google rechazó o no pudo verificar la credencial enviada.'
        Write-JsonResponse -Response $Context.Response -StatusCode 502 -Data @{ error = 'Google no pudo verificar la cuenta. Inténtalo de nuevo.' }
        return
    }

    if ($googleUser.aud -ne $clientId -or "$($googleUser.email_verified)".ToLowerInvariant() -ne 'true' -or
        [string]::IsNullOrWhiteSpace([string]$googleUser.email) -or [string]::IsNullOrWhiteSpace([string]$googleUser.sub)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 401 -Data @{ error = 'La cuenta de Google no pudo verificarse para esta tienda.' }
        return
    }

    $email = ([string]$googleUser.email).Trim().ToLowerInvariant()
    $users = @()
    if ($values.users_v1 -is [string]) {
        $users = ConvertFrom-Json -InputObject $values.users_v1
    }
    $user = $users | Where-Object { $_.email -and $_.email.Equals($email, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
    if ($user -and $user.role -ne 'customer') {
        Write-JsonResponse -Response $Context.Response -StatusCode 403 -Data @{ error = 'El acceso con Google está disponible solo para clientes.' }
        return
    }
    if ($user -and ($user.status -eq 'frozen' -or $user.status -eq 'paused')) {
        Write-JsonResponse -Response $Context.Response -StatusCode 403 -Data @{ error = 'La cuenta de cliente está suspendida. Contacta al Administrador.' }
        return
    }
    if ($user -and $user.googleSub -and $user.googleSub -ne $googleUser.sub) {
        Write-JsonResponse -Response $Context.Response -StatusCode 403 -Data @{ error = 'Esta cuenta ya está vinculada a otra cuenta de Google.' }
        return
    }

    $created = $false
    if (-not $user) {
        $name = if ([string]::IsNullOrWhiteSpace([string]$googleUser.name)) { $email } else { [string]$googleUser.name }
        $user = [PSCustomObject]@{
            dni = ''
            email = $email
            pass = ''
            name = $name
            role = 'customer'
            status = 'active'
            googleSub = [string]$googleUser.sub
        }
        $users = @($users) + @($user)
        $created = $true
    } else {
        $user | Add-Member -MemberType NoteProperty -Name googleSub -Value ([string]$googleUser.sub) -Force
    }

    $usersJson = ConvertTo-Json -InputObject ([object[]]$users) -Depth 30 -Compress
    $values | Add-Member -MemberType NoteProperty -Name users_v1 -Value $usersJson -Force
    Save-Database -Database $database
    Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ user = $user; users = @($users); created = $created }
}

function Invoke-CreateOrderRequest {
    param([System.Net.HttpListenerContext]$Context)

    if ($Context.Request.HttpMethod -ne 'POST') {
        Write-JsonResponse -Response $Context.Response -StatusCode 405 -Data @{ error = 'Método no permitido.' }
        return
    }

    $requestData = Read-JsonRequestBody -Context $Context -MaximumBytes 131072
    if ($null -eq $requestData) { return }
    if ($requestData.requestId -isnot [string] -or [string]::IsNullOrWhiteSpace($requestData.requestId) -or $requestData.requestId.Length -gt 100 -or
        $requestData.customerEmail -isnot [string] -or $requestData.customerEmail.Length -gt 254) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La solicitud del pedido no es válida.' }
        return
    }

    $database = Read-Database
    $values = $database.values
    $users = @()
    if ($values.users_v1 -is [string]) {
        $users = ConvertFrom-Json -InputObject $values.users_v1
    }
    $customerEmail = $requestData.customerEmail.Trim().ToLowerInvariant()
    $user = $users | Where-Object { $_.email -and $_.email.Equals($customerEmail, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
    if (-not $user -or $user.role -ne 'customer' -or $user.status -eq 'frozen' -or $user.status -eq 'paused') {
        Write-JsonResponse -Response $Context.Response -StatusCode 403 -Data @{ error = 'Inicia sesión con una cuenta de cliente activa para realizar el pedido.' }
        return
    }

    if ($values.site_config_v1 -isnot [string]) {
        Write-JsonResponse -Response $Context.Response -StatusCode 409 -Data @{ error = 'Administración debe configurar la dirección de la sucursal o punto de retiro.' }
        return
    }
    $siteConfig = ConvertFrom-Json -InputObject $values.site_config_v1
    $pickupAddress = ([string]$siteConfig.branchAddress).Trim()
    if ([string]::IsNullOrWhiteSpace($pickupAddress)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 409 -Data @{ error = 'Administración debe configurar la dirección de la sucursal o punto de retiro.' }
        return
    }

    $orders = @()
    if ($values.orders_v1 -is [string]) {
        $orders = ConvertFrom-Json -InputObject $values.orders_v1
    }
    $archivedOrders = @()
    if ($values.archived_orders_v1 -is [string]) {
        $archivedOrders = ConvertFrom-Json -InputObject $values.archived_orders_v1
    }
    $products = @()
    if ($values.products_v1 -is [string]) {
        $products = ConvertFrom-Json -InputObject $values.products_v1
    }

    $existingOrder = @($orders) + @($archivedOrders) |
        Where-Object { $_.requestId -eq $requestData.requestId -and $_.customerEmail -and $_.customerEmail.Equals($customerEmail, [System.StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 1
    if ($existingOrder) {
        Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ order = $existingOrder; orders = @($orders); products = @($products) }
        return
    }

    $requestedItems = @($requestData.items)
    if ($requestedItems.Count -lt 1 -or $requestedItems.Count -gt 100) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El pedido debe contener entre 1 y 100 productos.' }
        return
    }

    $orderItems = @()
    $seenProductIds = @{}
    $total = 0
    foreach ($requestedItem in $requestedItems) {
        if ($null -eq $requestedItem.id -or "$($requestedItem.qty)" -notmatch '^\d+$') {
            Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'Los productos o cantidades del pedido no son válidos.' }
            return
        }
        $productId = [string]$requestedItem.id
        $quantity = [int]$requestedItem.qty
        if ($quantity -lt 1 -or $quantity -gt 1000 -or $seenProductIds.ContainsKey($productId)) {
            Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La cantidad de productos del pedido no es válida.' }
            return
        }
        $seenProductIds[$productId] = $true
        $product = $products | Where-Object { [string]$_.id -eq $productId } | Select-Object -First 1
        if (-not $product -or [int]$product.stock -lt $quantity) {
            Write-JsonResponse -Response $Context.Response -StatusCode 409 -Data @{ error = 'El stock cambió. Actualiza el catálogo y revisa tu carrito.' }
            return
        }

        $price = [int][Math]::Round([double]$product.price)
        $cost = $null
        if ($null -ne $product.cost -and "$($product.cost)" -ne '') {
            $cost = [int][Math]::Round([double]$product.cost)
        }
        $orderItems += [PSCustomObject]@{
            id = $product.id
            name = [string]$product.name
            qty = $quantity
            price = $price
            cost = $cost
        }
        $total += $price * $quantity
    }

    $sequence = 0
    if ($null -ne $values.order_sequence) {
        $sequence = [int]$values.order_sequence
    }
    foreach ($existing in @($orders) + @($archivedOrders)) {
        if ([string]$existing.id -match '^Orden\s+(\d+)$') {
            $sequence = [Math]::Max($sequence, [int]$Matches[1])
        }
    }
    $sequence++
    $order = [PSCustomObject]@{
        id = 'Orden {0:D2}' -f $sequence
        requestId = $requestData.requestId
        customer = [string]$user.name
        customerEmail = $customerEmail
        items = $orderItems
        total = $total
        status = 'Pendiente'
        date = Get-Date -Format 'yyyy-MM-dd HH:mm'
        paymentMethod = 'Pago en sucursal o punto de retiro'
        pickupAddress = $pickupAddress
    }

    foreach ($product in $products) {
        $orderedItem = $orderItems | Where-Object { [string]$_.id -eq [string]$product.id } | Select-Object -First 1
        if ($orderedItem) {
            $product.stock = [int]$product.stock - [int]$orderedItem.qty
        }
    }
    $newOrders = @($order) + @($orders)
    $values | Add-Member -MemberType NoteProperty -Name orders_v1 -Value (ConvertTo-Json -InputObject $newOrders -Depth 30 -Compress) -Force
    $values | Add-Member -MemberType NoteProperty -Name products_v1 -Value (ConvertTo-Json -InputObject ([object[]]$products) -Depth 30 -Compress) -Force
    $values | Add-Member -MemberType NoteProperty -Name order_sequence -Value $sequence -Force
    Save-Database -Database $database
    Write-JsonResponse -Response $Context.Response -StatusCode 201 -Data @{ order = $order; orders = $newOrders; products = @($products) }
}

function Test-AssistantAdminAuthorization {
    param([System.Net.HttpListenerContext]$Context)

    $email = [string]$Context.Request.Headers['X-Admin-Email']
    $password = [string]$Context.Request.Headers['X-Admin-Password']
    if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrEmpty($password)) {
        return $false
    }

    $database = Read-Database
    if ($database.values.users_v1 -isnot [string]) {
        return $false
    }
    $users = ConvertFrom-Json -InputObject $database.values.users_v1
    $user = @($users | Where-Object {
        $_.email -and $_.email.Equals($email, [System.StringComparison]::OrdinalIgnoreCase)
    } | Select-Object -First 1)
    if ($user.Count -eq 0) {
        return $false
    }

    return $user[0].role -eq 'admin' -and $user[0].status -eq 'active' -and
        [string]$user[0].pass -ceq $password
}

function Save-AssistantCases {
    param([object[]]$Cases)

    $temporaryPath = "$assistantCasesPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $backupPath = "$temporaryPath.bak"
    try {
        $json = ConvertTo-Json -InputObject @($Cases) -Depth 10
        [System.IO.File]::WriteAllText($temporaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $assistantCasesPath) {
            [System.IO.File]::Replace($temporaryPath, $assistantCasesPath, $backupPath)
        } else {
            [System.IO.File]::Move($temporaryPath, $assistantCasesPath)
        }
    } finally {
        foreach ($pathToClean in @($temporaryPath, $backupPath)) {
            if (Test-Path -LiteralPath $pathToClean) {
                Remove-Item -LiteralPath $pathToClean -Force
            }
        }
    }
}

function Invoke-AssistantCasesRequest {
    param([System.Net.HttpListenerContext]$Context)

    if ($Context.Request.HttpMethod -notin @('GET', 'PUT')) {
        Write-JsonResponse -Response $Context.Response -StatusCode 405 -Data @{ error = 'Método no permitido.' }
        return
    }
    if (-not (Test-AssistantAdminAuthorization -Context $Context)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 403 -Data @{ error = 'Se requiere una sesión activa de Administrador General.' }
        return
    }

    if ($Context.Request.HttpMethod -eq 'GET') {
        $cases = @()
        if (Test-Path -LiteralPath $assistantCasesPath) {
            $storedCases = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($assistantCasesPath, [System.Text.Encoding]::UTF8))
            if ($null -ne $storedCases) {
                $cases = @($storedCases)
            }
        }
        Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ cases = $cases }
        return
    }

    $requestData = Read-JsonRequestBody -Context $Context -MaximumBytes 4096
    if ($null -eq $requestData) { return }
    if ($requestData.caseId -isnot [string] -or $requestData.caseId.Length -gt 80 -or $requestData.status -ne 'resolved') {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La actualización del caso no es válida.' }
        return
    }

    $cases = @()
    if (Test-Path -LiteralPath $assistantCasesPath) {
        $storedCases = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($assistantCasesPath, [System.Text.Encoding]::UTF8))
        if ($null -ne $storedCases) {
            $cases = @($storedCases)
        }
    }
    $case = $cases | Where-Object { $_.id -eq $requestData.caseId } | Select-Object -First 1
    if (-not $case) {
        Write-JsonResponse -Response $Context.Response -StatusCode 404 -Data @{ error = 'No se encontró el caso de asistencia.' }
        return
    }

    $case.status = 'resolved'
    $case.resolvedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    try {
        Save-AssistantCases -Cases $cases
    } catch {
        Write-Error "Could not update assistant case: $($_.Exception.Message)"
        Write-JsonResponse -Response $Context.Response -StatusCode 500 -Data @{ error = 'No se pudo actualizar el caso de asistencia.' }
        return
    }
    Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ cases = $cases }
}

function Invoke-GeminiRequest {
    param([System.Net.HttpListenerContext]$Context)

    if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 503 -Data @{
            error = 'Falta configurar GEMINI_API_KEY. Sigue los pasos de README.md y reinicia el servidor.'
        }
        return
    }

    if ($Context.Request.ContentLength64 -gt 131072) {
        Write-JsonResponse -Response $Context.Response -StatusCode 413 -Data @{ error = 'La consulta es demasiado grande.' }
        return
    }

    $requestData = Read-JsonRequestBody -Context $Context -MaximumBytes 131072
    if ($null -eq $requestData) { return }

    if ($requestData.message -isnot [string] -or [string]::IsNullOrWhiteSpace($requestData.message) -or $requestData.message.Length -gt 2000) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'Escribe una pregunta de hasta 2000 caracteres.' }
        return
    }

    if ($requestData.siteName -isnot [string] -or $requestData.siteName.Length -gt 120) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La configuración de la tienda no es válida.' }
        return
    }

    $history = @($requestData.history)
    if ($history.Count -gt 12) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'La conversación enviada supera el límite permitido.' }
        return
    }
    foreach ($turn in $history) {
        if ($turn.role -notin @('user', 'model') -or $turn.text -isnot [string] -or $turn.text.Length -gt 5000) {
            Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El historial de conversación no es válido.' }
            return
        }
    }

    $customerName = [string]$requestData.customerName
    if ($customerName.Length -gt 100) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El nombre del cliente supera el límite permitido.' }
        return
    }

    $products = @($requestData.products)
    if ($products.Count -gt 100) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El catálogo enviado supera el límite permitido.' }
        return
    }

    $orders = @($requestData.orders)
    if ($orders.Count -gt 10) {
        Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'El historial de pedidos enviado supera el límite permitido.' }
        return
    }

    $catalogLines = @(
        foreach ($product in $products) {
            if ($product.name -is [string]) {
                $description = if ($product.description -is [string]) { $product.description } else { '' }
                $category = if ($product.category -is [string]) { $product.category } else { 'Sin categoría' }
                "- $($product.name) | Categoría: $category | Precio: `$$($product.price) | Stock: $($product.stock) | Descripción: $description"
            }
        }
    )
    $catalog = if ($catalogLines.Count -gt 0) { $catalogLines -join "`n" } else { 'No hay productos disponibles.' }
    $orderLines = @(
        foreach ($order in $orders) {
            if ($order.id -is [string]) {
                $itemLines = @(
                    foreach ($item in @($order.items)) {
                        if ($item.name -is [string]) {
                            "$($item.name) x$($item.qty)"
                        }
                    }
                )
                $date = if ($order.date -is [string]) { $order.date } else { '' }
                $status = if ($order.status -is [string]) { $order.status } else { '' }
                "Pedido $($order.id) | Fecha: $date | Estado: $status | Artículos: $($itemLines -join ', ')"
            }
        }
    )
    $orderContext = if ($orderLines.Count -gt 0) { $orderLines -join "`n" } else { 'No hay pedidos previos disponibles.' }

    if (-not (Test-Path -LiteralPath $assistantInstructionsPath)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 500 -Data @{ error = 'No se encontró el archivo de instrucciones del asistente.' }
        return
    }
    try {
        $database = Read-Database
        $siteConfig = [PSCustomObject]@{}
        if ($database.values.site_config_v1 -is [string]) {
            $siteConfig = ConvertFrom-Json -InputObject $database.values.site_config_v1
        }
        $systemInstruction = [System.IO.File]::ReadAllText($assistantInstructionsPath, [System.Text.Encoding]::UTF8)
    } catch {
        Write-Error "Could not load assistant configuration: $($_.Exception.Message)"
        Write-JsonResponse -Response $Context.Response -StatusCode 500 -Data @{ error = 'No se pudieron cargar las instrucciones del asistente.' }
        return
    }

    $shippingPolicy = [string]$siteConfig.assistantShippingPolicy
    if ([string]::IsNullOrWhiteSpace($shippingPolicy)) {
        $shippingPolicy = 'No configurados. No inventes condiciones y deriva la consulta a Administración General.'
    }
    $paymentPolicy = [string]$siteConfig.assistantPaymentPolicy
    if ([string]::IsNullOrWhiteSpace($paymentPolicy)) {
        $paymentPolicy = 'No configurados. No inventes métodos y deriva la consulta a Administración General.'
    }
    $customInstructions = ''
    if ($null -ne $siteConfig.assistantCustomInstructions) {
        if ($siteConfig.assistantCustomInstructions -isnot [string] -or $siteConfig.assistantCustomInstructions.Length -gt 3000) {
            Write-JsonResponse -Response $Context.Response -StatusCode 400 -Data @{ error = 'Las instrucciones adicionales del asistente no son válidas.' }
            return
        }
        $customInstructions = $siteConfig.assistantCustomInstructions.Trim()
    }
    $systemInstruction = $systemInstruction.Replace('{{STORE_NAME}}', $requestData.siteName)
    $systemInstruction = $systemInstruction.Replace('{{SHIPPING_POLICY}}', $shippingPolicy)
    $systemInstruction = $systemInstruction.Replace('{{PAYMENT_POLICY}}', $paymentPolicy)
    if (-not [string]::IsNullOrWhiteSpace($customInstructions)) {
        $systemInstruction += "`n`nINSTRUCCIONES ADICIONALES CONFIGURADAS POR LA TIENDA:`n$customInstructions"
    }

    $contents = @(
        foreach ($turn in $history) {
            @{
                role = $turn.role
                parts = @(@{ text = $turn.text })
            }
        }
    )
    $currentPrompt = @"
CATÁLOGO ACTUAL:
$catalog

CLIENTE: $(if ([string]::IsNullOrWhiteSpace($customerName)) { 'No identificado' } else { $customerName })
HISTORIAL DE PEDIDOS DEL CLIENTE:
$orderContext

MENSAJE ACTUAL:
$($requestData.message)
"@
    $contents += @{
        role = 'user'
        parts = @(@{ text = $currentPrompt })
    }

    $payload = @{
        contents = $contents
        systemInstruction = @{
            parts = @(@{ text = $systemInstruction })
        }
        generationConfig = @{
            maxOutputTokens = 900
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
        return
    }

    if ([string]::IsNullOrWhiteSpace($answer)) {
        Write-JsonResponse -Response $Context.Response -StatusCode 502 -Data @{ error = 'Gemini no devolvió una respuesta. Inténtalo de nuevo.' }
        return
    }

    $publicAnswer = $answer.Trim()
    $marker = '#DERIVAR_ADMIN'
    $markerIndex = $answer.IndexOf($marker, [System.StringComparison]::Ordinal)
    if ($markerIndex -ge 0) {
        $internalNote = $answer.Substring($markerIndex).Trim()
        $publicAnswer = $answer.Substring(0, $markerIndex).Trim()
        if ([string]::IsNullOrWhiteSpace($publicAnswer)) {
            Write-JsonResponse -Response $Context.Response -StatusCode 502 -Data @{ error = 'El asistente no generó una respuesta para el cliente.' }
            return
        }

        $closingPhrase = 'En cuanto tengamos más info te avisaremos.'
        if (-not $publicAnswer.EndsWith($closingPhrase, [System.StringComparison]::Ordinal)) {
            $publicAnswer = "$($publicAnswer.TrimEnd())`n`n$closingPhrase"
        }

        try {
            $cases = @()
            if (Test-Path -LiteralPath $assistantCasesPath) {
                $storedCases = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($assistantCasesPath, [System.Text.Encoding]::UTF8))
                if ($null -ne $storedCases) {
                    $cases = @($storedCases)
                }
            }
            $case = [PSCustomObject]@{
                id = [Guid]::NewGuid().ToString()
                createdAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                status = 'pending'
                customerName = if ([string]::IsNullOrWhiteSpace($customerName)) { 'Cliente sin identificar' } else { $customerName }
                message = $requestData.message
                note = $internalNote
            }
            $cases = @($case) + @($cases)
            Save-AssistantCases -Cases $cases
        } catch {
            Write-Error "Could not save assistant escalation: $($_.Exception.Message)"
            Write-JsonResponse -Response $Context.Response -StatusCode 500 -Data @{ error = 'No se pudo registrar el caso para Administración. Inténtalo nuevamente.' }
            return
        }
    }

    Write-JsonResponse -Response $Context.Response -StatusCode 200 -Data @{ text = $publicAnswer }
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
            } elseif ($path -eq '/api/orders') {
                Invoke-CreateOrderRequest -Context $context
            } elseif ($path -eq '/api/google-auth') {
                Invoke-GoogleAuthRequest -Context $context
            } elseif ($path -eq '/api/gemini') {
                if ($context.Request.HttpMethod -ne 'POST') {
                    Write-JsonResponse -Response $context.Response -StatusCode 405 -Data @{ error = 'Método no permitido.' }
                } else {
                    Invoke-GeminiRequest -Context $context
                }
            } elseif ($path -eq '/js/app.js' -and $context.Request.HttpMethod -eq 'GET') {
                $scriptPath = Join-Path $baseDirectory 'js\app.js'
                $script = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)
                Write-Response -Response $context.Response -StatusCode 200 -ContentType 'application/javascript; charset=utf-8' -Body $script
            } elseif ($path -eq '/js/assistant.js' -and $context.Request.HttpMethod -eq 'GET') {
                $scriptPath = Join-Path $baseDirectory 'js\assistant.js'
                $script = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)
                Write-Response -Response $context.Response -StatusCode 200 -ContentType 'application/javascript; charset=utf-8' -Body $script
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
