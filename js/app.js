        const STORAGE_KEYS = {
            USERS: 'users_v1',
            PRODUCTS: 'products_v1',
            ORDERS: 'orders_v1',
            ARCHIVED_ORDERS: 'archived_orders_v1',
            CURRENT_USER: 'current_user_v1',
            SITE_CONFIG: 'site_config_v1'
        };

        const SHARED_STORAGE_KEYS = [
            STORAGE_KEYS.USERS,
            STORAGE_KEYS.PRODUCTS,
            STORAGE_KEYS.ORDERS,
            STORAGE_KEYS.ARCHIVED_ORDERS,
            STORAGE_KEYS.SITE_CONFIG
        ];
        const nativeStorageSetItem = Storage.prototype.setItem;
        let sharedStorageEnabled = false;
        let sharedStorageWriteQueue = Promise.resolve();
        let pendingSharedWrites = 0;
        let applyingSharedData = false;

        function writeSharedStorageValue(key, value) {
            return fetch('/api/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            }).then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'No se pudieron guardar los datos compartidos.');
            });
        }

        function queueSharedStorageWrite(key, value) {
            if (!sharedStorageEnabled || applyingSharedData || !SHARED_STORAGE_KEYS.includes(key)) return;
            pendingSharedWrites++;
            sharedStorageWriteQueue = sharedStorageWriteQueue
                .then(() => writeSharedStorageValue(key, value))
                .catch(error => {
                    console.error('Error al guardar los datos compartidos:', error);
                    showToast('No se pudo guardar en el servidor. Comprueba la conexión e inténtalo de nuevo.', 'error');
                })
                .then(() => {
                    pendingSharedWrites--;
                });
        }

        Storage.prototype.setItem = function(key, value) {
            nativeStorageSetItem.call(this, key, value);
            if (this === localStorage) queueSharedStorageWrite(key, String(value));
        };

        async function initializeSharedStorage() {
            try {
                const response = await fetch('/api/data');
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'No se pudieron cargar los datos compartidos.');

                const values = result.values || {};
                for (const key of SHARED_STORAGE_KEYS) {
                    if (Object.prototype.hasOwnProperty.call(values, key)) {
                        nativeStorageSetItem.call(localStorage, key, values[key]);
                    } else {
                        const localValue = localStorage.getItem(key);
                        if (localValue !== null) await writeSharedStorageValue(key, localValue);
                    }
                }
                sharedStorageEnabled = true;
                return true;
            } catch (error) {
                console.error('No se pudo iniciar el almacenamiento compartido:', error);
                showToast('No se pudo conectar con la base de datos. Los cambios quedarán solo en este dispositivo.', 'error');
                return false;
            }
        }

        async function refreshSharedStorage() {
            if (!sharedStorageEnabled || pendingSharedWrites > 0) return;
            try {
                const response = await fetch('/api/data');
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'No se pudieron actualizar los datos compartidos.');

                let changed = false;
                applyingSharedData = true;
                for (const key of SHARED_STORAGE_KEYS) {
                    const remoteValue = result.values && result.values[key];
                    if (typeof remoteValue === 'string' && localStorage.getItem(key) !== remoteValue) {
                        nativeStorageSetItem.call(localStorage, key, remoteValue);
                        changed = true;
                    }
                }
                applyingSharedData = false;
                if (changed) renderApp();
            } catch (error) {
                applyingSharedData = false;
                console.error('Error al actualizar los datos compartidos:', error);
            }
        }

        window.addEventListener('storage', event => {
            if (SHARED_STORAGE_KEYS.includes(event.key)) renderApp();
        });

        const defaultSiteConfig = {
            siteName: 'Tienda',
            branchAddress: '',
            googleClientId: '',
            whatsappContacts: [],
            socialLinks: [],
            brandColor: '#6366f1',
            heroGradientFrom: '#4f46e5',
            heroGradientTo: '#4338ca',
            heroBadge: 'Catálogo Completo',
            heroTitle: 'Descubre Tecnología y Tendencias',
            heroSubtitle: 'Explora nuestros productos destacados y realiza tus compras con la mayor rapidez y comodidad.',
            heroImage: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=800&auto=format&fit=crop&q=60',
            showHero: true,
            catalogTitle: 'Productos Disponibles',
            catalogSubtitle: 'Explora la lista completa en tiempo real.',
            searchPlaceholder: 'Buscar productos...',
            showAiAssistant: true,
            gridCols: 4,
            layoutOrder: ['hero', 'search', 'grid']
        };

        function getSiteConfig() {
            const stored = localStorage.getItem(STORAGE_KEYS.SITE_CONFIG);
            const config = stored ? { ...defaultSiteConfig, ...JSON.parse(stored) } : { ...defaultSiteConfig };
            config.whatsappContacts = Array.isArray(config.whatsappContacts) ? config.whatsappContacts : [];
            config.socialLinks = Array.isArray(config.socialLinks) ? config.socialLinks : [];
            return config;
        }

        function escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, character => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[character]);
        }

        function getGoogleMapsUrl(address) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        }

        function getGoogleMapsEmbedUrl(address) {
            return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
        }

        function getSafeExternalUrl(value) {
            if (typeof value !== 'string' || !value.trim()) return '';
            try {
                const url = new URL(value.trim());
                return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
            } catch {
                return '';
            }
        }

        function roundAmount(value) {
            const amount = Number(value);
            return Number.isFinite(amount) ? Math.round(amount) : 0;
        }

        function formatCurrency(value) {
            return `$${roundAmount(value).toLocaleString('en-US')}`;
        }

        function getLocalDateTime(date = new Date()) {
            const pad = value => String(value).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }

        function getLocalMonthValue(date = new Date()) {
            return getLocalDateTime(date).slice(0, 7);
        }

        function getOrderMonthValue(order) {
            const reportDate = order.deliveredAt || order.date || '';
            const match = String(reportDate).match(/^(\d{4}-\d{2})/);
            return match ? match[1] : '';
        }

        function getArchiveIdentity(order) {
            return `${order.id}|${order.customer}|${order.date}`;
        }
        

        function normalizeStoredAmounts() {
            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
            let productsChanged = false;
            products.forEach(product => {
                const price = roundAmount(product.price);
                if (product.price !== price) {
                    product.price = price;
                    productsChanged = true;
                }
                if (product.cost !== undefined && product.cost !== null && product.cost !== '') {
                    const cost = roundAmount(product.cost);
                    if (product.cost !== cost) {
                        product.cost = cost;
                        productsChanged = true;
                    }
                }
            });
            if (productsChanged) localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));

            [STORAGE_KEYS.ORDERS, STORAGE_KEYS.ARCHIVED_ORDERS].forEach(key => {
                const orders = JSON.parse(localStorage.getItem(key));
                let ordersChanged = false;
                orders.forEach(order => {
                    const total = roundAmount(order.total);
                    if (order.total !== total) {
                        order.total = total;
                        ordersChanged = true;
                    }
                    (order.items || []).forEach(item => {
                        const price = roundAmount(item.price);
                        if (item.price !== price) {
                            item.price = price;
                            ordersChanged = true;
                        }
                        if (item.cost !== undefined && item.cost !== null && item.cost !== '') {
                            const cost = roundAmount(item.cost);
                            if (item.cost !== cost) {
                                item.cost = cost;
                                ordersChanged = true;
                            }
                        }
                    });
                });
                if (ordersChanged) localStorage.setItem(key, JSON.stringify(orders));
            });
        }

        function archiveDeliveredOrders() {
            const orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS));
            const archivedOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS));
            const archivedKeys = new Set(archivedOrders.map(getArchiveIdentity));
            const remainingOrders = [];
            let changed = false;

            orders.forEach(order => {
                if (order.status !== 'Entregado') {
                    remainingOrders.push(order);
                    return;
                }
                const identity = getArchiveIdentity(order);
                if (!archivedKeys.has(identity)) {
                    archivedOrders.push({
                        ...order,
                        deliveredAt: order.deliveredAt || order.date || getLocalDateTime()
                    });
                    archivedKeys.add(identity);
                }
                changed = true;
            });

            if (changed) {
                localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(remainingOrders));
                localStorage.setItem(STORAGE_KEYS.ARCHIVED_ORDERS, JSON.stringify(archivedOrders));
            }
        }

        function saveSiteConfig(config) {
            localStorage.setItem(STORAGE_KEYS.SITE_CONFIG, JSON.stringify(config));
            showToast('¡Configuración de la página guardada correctamente!');
            renderApp();
        }

        const defaultProducts = [
            { id: 1, name: 'Auriculares Inalámbricos Pro', price: 129.99, category: 'Tecnología', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&auto=format&fit=crop&q=60', stock: 25, description: 'Cancelación activa de ruido y sonido espacial envolvente.' },
            { id: 2, name: 'Reloj Inteligente Sport Edition', price: 199.50, category: 'Wearables', image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60', stock: 14, description: 'Monitoreo cardíaco 24/7 y resistencia al agua 5ATM.' },
            { id: 3, name: 'Mochila Urbana Antirrobo', price: 65.00, category: 'Accesorios', image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&auto=format&fit=crop&q=60', stock: 40, description: 'Compartimento acolchado para portátil y puerto de carga USB.' },
            { id: 4, name: 'Cámara Mirrorless 4K', price: 849.00, category: 'Tecnología', image: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60', stock: 8, description: 'Sensor de alta resolución y grabación de video profesional en 4K.' }
        ];

        const defaultOrders = [
            { id: 'ORD-1001', customer: 'María Cliente', items: [{ name: 'Auriculares Inalámbricos Pro', qty: 1, price: 129.99 }], total: 129.99, status: 'Pendiente', date: '2026-10-11 10:30' },
            { id: 'ORD-1002', customer: 'María Cliente', items: [{ name: 'Mochila Urbana Antirrobo', qty: 2, price: 65.00 }], total: 130.00, status: 'Preparando', date: '2026-10-11 11:15' }
        ];

        function initStorage() {
            if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
                localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(defaultProducts));
            }
            if (!localStorage.getItem(STORAGE_KEYS.ORDERS)) {
                localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(defaultOrders));
            }
            if (!localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS)) {
                localStorage.setItem(STORAGE_KEYS.ARCHIVED_ORDERS, JSON.stringify([]));
            }
            if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
                const initialUsers = [
                    { dni: '46863375', email: 'impretech@gmail.com', pass: '2007', name: 'Administrador General', role: 'admin', status: 'active' },
                    { dni: '87654321', email: 'empleado@gmail.com', pass: '1234', name: 'Juan Logística', role: 'employee', status: 'active' },
                    { dni: '12345678', email: 'cliente@gmail.com', pass: '1234', name: 'María Cliente', role: 'customer', status: 'active' }
                ];
                localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(initialUsers));
            }
            normalizeStoredAmounts();
            archiveDeliveredOrders();
        }

        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            const messageEl = document.getElementById('toast-message');
            const iconEl = document.getElementById('toast-icon');
            
            messageEl.textContent = message;
            iconEl.className = type === 'success' 
                ? 'fa-solid fa-circle-check text-emerald-400 text-lg' 
                : 'fa-solid fa-triangle-exclamation text-amber-400 text-lg';

            toast.classList.remove('translate-y-20', 'opacity-0');
            toast.classList.add('translate-y-0', 'opacity-100');

            setTimeout(() => {
                toast.classList.remove('translate-y-0', 'opacity-100');
                toast.classList.add('translate-y-20', 'opacity-0');
            }, 3000);
        }

        function getCurrentUser() {
            const userStr = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
            return userStr ? JSON.parse(userStr) : null;
        }

        function setCurrentUser(user) {
            customerMenuOpen = false;
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
            closeLoginModal();
            renderApp();
        }

        function logout() {
            customerMenuOpen = false;
            customerActiveTab = 'catalog';
            localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            renderApp();
            showToast('Sesión cerrada correctamente', 'success');
        }

        function openLoginModal() {
            customerMenuOpen = false;
            document.getElementById('login-dni').value = '';
            document.getElementById('login-email').value = '';
            document.getElementById('login-pass').value = '';
            updateLoginCredentialFields();
            setupGoogleSignIn();
            document.getElementById('login-modal').classList.remove('hidden');
        }

        let initializedGoogleClientId = '';

        function setupGoogleSignIn() {
            const container = document.getElementById('google-signin-button');
            if (!container) return;

            const clientId = getSiteConfig().googleClientId.trim();
            container.replaceChildren();
            if (!clientId) {
                container.innerHTML = `
                    <button type="button" onclick="startGoogleSignIn()" class="w-full max-w-xs py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2">
                        <i class="fa-brands fa-google text-red-500"></i> Continuar con Google
                    </button>
                `;
                return;
            }

            if (!window.google || !window.google.accounts || !window.google.accounts.id) {
                container.innerHTML = `
                    <button type="button" onclick="startGoogleSignIn()" class="w-full max-w-xs py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2">
                        <i class="fa-brands fa-google text-red-500"></i> Continuar con Google
                    </button>
                `;
                return;
            }

            if (initializedGoogleClientId !== clientId) {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: handleGoogleCredentialResponse
                });
                initializedGoogleClientId = clientId;
            }
            window.google.accounts.id.renderButton(container, {
                theme: 'outline',
                size: 'large',
                text: 'continue_with',
                shape: 'rectangular',
                width: 320
            });
        }

        function startGoogleSignIn() {
            if (!getSiteConfig().googleClientId.trim()) {
                showToast('Administración debe configurar el Client ID de Google.', 'error');
                return;
            }
            if (!window.google || !window.google.accounts || !window.google.accounts.id) {
                showToast('No se pudo cargar el inicio de sesión de Google. Comprueba tu conexión.', 'error');
                return;
            }
            setupGoogleSignIn();
        }

        async function handleGoogleCredentialResponse(response) {
            if (!response || !response.credential) {
                showToast('Google no devolvió una credencial válida.', 'error');
                return;
            }
            if (!sharedStorageEnabled) {
                showToast('No se pudo conectar con la base de datos. Inténtalo de nuevo.', 'error');
                return;
            }

            pendingSharedWrites++;
            try {
                await sharedStorageWriteQueue;
                const apiResponse = await fetch('/api/google-auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ credential: response.credential })
                });
                const result = await apiResponse.json();
                if (!apiResponse.ok) throw new Error(result.error || 'No se pudo iniciar sesión con Google.');

                nativeStorageSetItem.call(localStorage, STORAGE_KEYS.USERS, JSON.stringify(result.users));
                setCurrentUser(result.user);
                showToast(`Bienvenido, ${result.user.name}`);
            } catch (error) {
                console.error('Error al iniciar sesión con Google:', error);
                showToast(error.message || 'No se pudo iniciar sesión con Google.', 'error');
            } finally {
                pendingSharedWrites--;
            }
        }

        function updateLoginCredentialFields() {
            const email = document.getElementById('login-email').value.trim().toLowerCase();
            const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
            const account = users.find(user => user.email && user.email.toLowerCase() === email);
            const requiresStaffCredentials = Boolean(account && account.role !== 'customer');

            document.getElementById('login-dni-field').classList.toggle('hidden', !requiresStaffCredentials);
            document.getElementById('login-pass-field').classList.toggle('hidden', !requiresStaffCredentials);
            document.getElementById('google-login-container').classList.toggle('hidden', requiresStaffCredentials);
            document.getElementById('login-dni').required = requiresStaffCredentials;
            document.getElementById('login-pass').required = requiresStaffCredentials;
        }

        function closeLoginModal() {
            document.getElementById('login-modal').classList.add('hidden');
        }

        function renderApp() {
            initStorage();
            const user = getCurrentUser();
            const app = document.getElementById('app');

            const siteConfig = getSiteConfig();
            document.documentElement.style.setProperty('--brand-color', siteConfig.brandColor);
            document.title = siteConfig.siteName;

            const aiWidget = document.getElementById('ai-assistant-container');
            if (aiWidget) {
                if (siteConfig.showAiAssistant) {
                    aiWidget.classList.remove('hidden');
                } else {
                    aiWidget.classList.add('hidden');
                }
            }

            if (!user) {
                app.innerHTML = renderCustomerLayout(null);
                attachCustomerEvents();
            } else if (user.role === 'customer') {
                app.innerHTML = renderCustomerLayout(user);
                attachCustomerEvents();
            } else if (user.role === 'admin') {
                app.innerHTML = renderAdminLayout(user);
                attachAdminEvents();
            } else if (user.role === 'employee') {
                app.innerHTML = renderEmployeeLayout(user);
                attachEmployeeEvents();
            }

            attachModalEvents();
        }

        function attachModalEvents() {
            const form = document.getElementById('modal-login-form');
            if (form) {
                const emailInput = document.getElementById('login-email');
                emailInput.oninput = updateLoginCredentialFields;
                updateLoginCredentialFields();
                form.onsubmit = async (e) => {
                    e.preventDefault();
                    const dni = document.getElementById('login-dni').value.trim();
                    const email = document.getElementById('login-email').value.trim().toLowerCase();
                    const pass = document.getElementById('login-pass').value;
                    const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS));
                    let user = users.find(account => account.email && account.email.toLowerCase() === email);

                    if (user && user.role !== 'customer' && (user.dni !== dni || user.pass !== pass)) {
                        showToast('D.N.I., correo o contraseña incorrectos.', 'error');
                        return;
                    }

                    if (!user) {
                        user = { dni: '', email, pass: '', name: email, role: 'customer', status: 'active' };
                        users.push(user);
                    }

                    if (user.status === 'frozen' || user.status === 'paused') {
                        showToast('Tu cuenta está congelada. Contacta al Administrador.', 'error');
                        return;
                    }

                    if (user.role === 'customer') {
                        const serializedUsers = JSON.stringify(users);
                        if (!sharedStorageEnabled) {
                            showToast('No se pudo guardar tu cuenta en la base de datos. Comprueba la conexión e inténtalo de nuevo.', 'error');
                            return;
                        }

                        pendingSharedWrites++;
                        const write = sharedStorageWriteQueue.then(() => writeSharedStorageValue(STORAGE_KEYS.USERS, serializedUsers));
                        sharedStorageWriteQueue = write
                            .catch(error => {
                                console.error('Error al guardar la cuenta del cliente:', error);
                                showToast('No se pudo guardar tu cuenta en la base de datos. Comprueba la conexión e inténtalo de nuevo.', 'error');
                            })
                            .then(() => {
                                pendingSharedWrites--;
                            });
                        try {
                            await write;
                        } catch {
                            return;
                        }
                        nativeStorageSetItem.call(localStorage, STORAGE_KEYS.USERS, serializedUsers);
                    }

                    setCurrentUser(user);
                    showToast(`Bienvenido, ${user.name}`);
                };
            }
        }

        let customerActiveTab = 'catalog';
        let customerMenuOpen = false;
        let cart = [];
        let isChatOpen = false;
        let isAiRequestPending = false;

        function toggleAiChat() {
            isChatOpen = !isChatOpen;
            const chatWindow = document.getElementById('ai-chat-window');
            if (isChatOpen) {
                chatWindow.classList.remove('hidden');
            } else {
                chatWindow.classList.add('hidden');
            }
        }

        function appendAiChatMessage(message, isUser = false) {
            const row = document.createElement('div');
            row.className = isUser ? 'flex gap-2 justify-end' : 'flex gap-2';

            if (!isUser) {
                const avatar = document.createElement('div');
                avatar.className = 'w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center flex-shrink-0 text-xs';
                avatar.textContent = 'IA';
                row.appendChild(avatar);
            }

            const bubble = document.createElement('div');
            bubble.className = isUser
                ? 'bg-brand-600 text-white p-3 rounded-2xl shadow-sm max-w-[80%] text-xs'
                : 'bg-white p-3 rounded-2xl shadow-sm border border-slate-200 text-slate-700 text-xs';
            bubble.textContent = message;
            row.appendChild(bubble);

            const messagesContainer = document.getElementById('ai-chat-messages');
            messagesContainer.appendChild(row);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            return row;
        }

        function handleAiChatSubmit(event) {
            event.preventDefault();
            sendAiMessage();
        }

        async function sendAiMessage() {
            const inputEl = document.getElementById('ai-chat-input');
            const submitButton = document.getElementById('ai-chat-submit');
            const text = inputEl.value.trim();
            if (!text || isAiRequestPending) return;

            isAiRequestPending = true;
            inputEl.disabled = true;
            submitButton.disabled = true;
            appendAiChatMessage(text, true);
            inputEl.value = '';

            const loadingMessage = appendAiChatMessage('Pensando respuesta...');

            try {
                const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
                const siteName = getSiteConfig().siteName;
                const response = await fetch('/api/gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        siteName,
                        products: products.map(product => ({
                            name: product.name,
                            price: product.price,
                            description: product.description,
                            stock: product.stock
                        }))
                    })
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || 'No se pudo contactar al servicio de Gemini.');
                }
                appendAiChatMessage(result.text);
            } catch (error) {
                console.error('Error al consultar el asistente virtual:', error);
                appendAiChatMessage(error.message || 'No se pudo contactar al asistente. Comprueba que el servidor esté iniciado e inténtalo de nuevo.');
            } finally {
                loadingMessage.remove();
                inputEl.disabled = false;
                submitButton.disabled = false;
                isAiRequestPending = false;
                inputEl.focus();
            }
        }

        function renderCustomerLayout(user) {
            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
            const activeOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS));
            const archivedOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS));
            const orders = user ? [...activeOrders, ...archivedOrders].filter(order =>
                order.customerEmail
                    ? order.customerEmail.toLowerCase() === user.email.toLowerCase()
                    : order.customer === user.name
            ) : [];
            const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
            const siteConfig = getSiteConfig();
            const siteName = escapeHtml(siteConfig.siteName);

            return `
                <div class="min-h-full flex flex-col bg-slate-50">
                    <header class="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
                        <div class="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 grid grid-cols-[1fr_auto_1fr] items-center">
                            <div></div>
                            <button type="button" onclick="setCustomerTab('catalog')" class="min-w-0 max-w-[55vw] sm:max-w-md text-center truncate font-bold text-lg sm:text-3xl tracking-tight" aria-label="Ir al inicio">
                                <span class="store-name-animated">${siteName}</span>
                            </button>
                            <div class="justify-self-end flex items-center gap-2">
                                <button onclick="setCustomerTab('cart')" class="relative p-2 sm:p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition">
                                    <i class="fa-solid fa-cart-shopping"></i>
                                    ${cartCount > 0 ? `<span class="absolute -top-1 -right-1 bg-brand-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">${cartCount}</span>` : ''}
                                </button>
                                <button
                                    type="button"
                                    onclick="toggleCustomerMenu()"
                                    aria-label="${customerMenuOpen ? 'Cerrar menú' : 'Abrir menú'}"
                                    aria-expanded="${customerMenuOpen}"
                                    aria-controls="customer-menu"
                                    class="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition flex items-center justify-center"
                                >
                                    <i class="fa-solid ${customerMenuOpen ? 'fa-xmark' : 'fa-bars'} text-lg"></i>
                                </button>
                            </div>
                            <div id="customer-menu" class="${customerMenuOpen ? '' : 'hidden'} customer-menu-panel absolute right-3 sm:right-6 lg:right-8 top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))] max-h-[75vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                                <div class="px-3 py-2">
                                    ${user ? `
                                        <p class="text-sm font-bold text-slate-900">${escapeHtml(user.name)}</p>
                                        <p class="text-xs text-slate-500">Cuenta de ${user.role === 'customer' ? 'cliente' : escapeHtml(user.role)}</p>
                                    ` : '<p class="text-sm font-semibold text-slate-900">Bienvenido</p>'}
                                </div>
                                <div class="border-t border-slate-100 pt-2">
                                    <button onclick="setCustomerTab('catalog')" class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition">
                                        <i class="fa-solid fa-house w-5 text-center text-brand-600"></i> Inicio
                                    </button>
                                    ${user ? `
                                        <button onclick="setCustomerTab('orders')" class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition">
                                            <i class="fa-solid fa-bag-shopping w-5 text-center text-brand-600"></i> Mis Compras (${orders.length})
                                        </button>
                                        <button onclick="logout()" class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50 transition">
                                            <i class="fa-solid fa-right-from-bracket w-5 text-center"></i> Cerrar sesión
                                        </button>
                                    ` : `
                                        <button onclick="openLoginFromMenu()" class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50 transition">
                                            <i class="fa-solid fa-user w-5 text-center"></i> Iniciar sesión
                                        </button>
                                    `}
                                </div>
                                <div class="border-t border-slate-100 mt-2 pt-3">
                                    ${renderCustomerContactLinks(siteConfig)}
                                </div>
                            </div>
                        </div>
                    </header>

                    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
                        ${customerActiveTab === 'catalog' ? renderCustomerCatalog(products) : ''}
                        ${customerActiveTab === 'orders' ? renderCustomerOrders(orders) : ''}
                        ${customerActiveTab === 'cart' ? renderCustomerCart(cart, cartTotal) : ''}
                    </main>

                    <footer class="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
                        &copy; 2026 ${siteName}. Todos los derechos reservados.
                    </footer>
                </div>
            `;
        }

        function setCustomerTab(tab) {
            customerActiveTab = tab;
            customerMenuOpen = false;
            renderApp();
        }

        function toggleCustomerMenu() {
            customerMenuOpen = !customerMenuOpen;
            renderApp();
        }

        function openLoginFromMenu() {
            customerMenuOpen = false;
            renderApp();
            openLoginModal();
        }

        function renderCustomerContactLinks(config) {
            const whatsappLinks = config.whatsappContacts
                .filter(contact => contact && contact.enabled !== false)
                .map(contact => {
                    const number = String(contact.number || '');
                    const digits = number.replace(/\D/g, '');
                    return digits ? `
                        <a href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 transition">
                            <i class="fa-brands fa-whatsapp w-5 text-center text-emerald-600 text-lg"></i>
                            <span class="min-w-0">
                                <span class="block font-semibold">${escapeHtml(contact.label || 'WhatsApp')}</span>
                                <span class="block text-xs text-slate-500">${escapeHtml(number)}</span>
                            </span>
                        </a>
                    ` : '';
                })
                .join('');
            const socialLinks = config.socialLinks
                .filter(link => link && link.enabled !== false)
                .map(link => {
                    const url = getSafeExternalUrl(link.url);
                    return url ? `
                        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-brand-50 transition">
                            <i class="fa-solid fa-arrow-up-right-from-square w-5 text-center text-brand-600"></i>
                            <span class="font-semibold">${escapeHtml(link.name || 'Red social')}</span>
                        </a>
                    ` : '';
                })
                .join('');
            const links = whatsappLinks + socialLinks;

            return `
                <section aria-label="Comunicación y redes">
                    <h3 class="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Comunicación y redes</h3>
                    ${links || '<p class="px-3 py-2 text-xs text-slate-500">Todavía no hay contactos publicados.</p>'}
                </section>
            `;
        }

        function renderCustomerCatalog(products) {
            const config = getSiteConfig();

            const heroBlock = `
                <div class="rounded-3xl p-6 sm:p-10 text-white mb-8 shadow-xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6"
                     style="background: linear-gradient(135deg, ${config.heroGradientFrom}, ${config.heroGradientTo});">
                    <div class="max-w-xl z-10">
                        <span class="bg-white/25 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-4 inline-block">${config.heroBadge}</span>
                        <h1 class="text-2xl sm:text-4xl font-extrabold tracking-tight mb-2">${config.heroTitle}</h1>
                        <p class="text-indigo-100 text-xs sm:text-sm">${config.heroSubtitle}</p>
                    </div>
                    ${config.heroImage ? `
                        <div class="w-full md:w-1/3 h-44 sm:h-52 rounded-2xl overflow-hidden shadow-lg border border-white/20 z-10 flex-shrink-0">
                            <img src="${config.heroImage}" alt="Imagen del banner principal" class="w-full h-full object-cover">
                        </div>
                    ` : ''}
                </div>
            `;

            const searchBlock = `
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h2 class="text-2xl font-bold text-slate-900">${config.catalogTitle}</h2>
                        <p class="text-sm text-slate-500">${config.catalogSubtitle}</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <input type="text" id="product-search" placeholder="${config.searchPlaceholder}" class="px-4 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none w-64">
                    </div>
                </div>
            `;

            const gridColsClass = config.gridCols == 2 ? 'grid-cols-1 sm:grid-cols-2' :
                                  config.gridCols == 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
                                  'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

            const gridBlock = `
                <div class="grid ${gridColsClass} gap-6" id="product-grid">
                    ${products.map(p => `
                        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition flex flex-col justify-between group">
                            <div>
                                <div class="relative h-48 overflow-hidden bg-slate-100">
                                    <img src="${p.image}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.src='https://placehold.co/400x300/e2e8f0/64748b?text=Producto'">
                                    <span class="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold text-slate-700 shadow-sm">${p.category}</span>
                                </div>
                                <div class="p-5">
                                    <h3 class="font-bold text-slate-900 mb-1 truncate">${p.name}</h3>
                                    <p class="text-xs text-slate-500 line-clamp-2 mb-4">${p.description}</p>
                                    <div class="flex items-center justify-between">
                                        <span class="text-lg font-bold text-brand-600">${formatCurrency(p.price)}</span>
                                        <span class="text-xs font-medium ${p.stock > 5 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'} px-2.5 py-1 rounded-lg">Existencias: ${p.stock}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="p-5 pt-0">
                                <button onclick="addToCart(${p.id})" class="w-full py-2.5 text-white font-semibold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2" style="background-color: ${config.brandColor}">
                                    <i class="fa-solid fa-cart-plus"></i> Añadir al Carrito
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

            let outputHtml = '<div>';
            config.layoutOrder.forEach(section => {
                if (section === 'hero' && config.showHero) outputHtml += heroBlock;
                if (section === 'search') outputHtml += searchBlock;
                if (section === 'grid') outputHtml += gridBlock;
            });
            outputHtml += '</div>';

            return outputHtml;
        }

        function addToCart(productId) {
            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
            const product = products.find(p => p.id === productId);
            if (!product || product.stock <= 0) {
                showToast('Producto sin stock disponible', 'error');
                return;
            }
            const existing = cart.find(item => item.id === productId);
            if (existing) {
                if (existing.qty < product.stock) {
                    existing.qty++;
                } else {
                    showToast('Has alcanzado el límite de stock disponible', 'error');
                    return;
                }
            } else {
                cart.push({ ...product, qty: 1 });
            }
            showToast(`Añadido al carrito: ${product.name}`);
            renderApp();
        }

        function renderCustomerCart(cart, total) {
            const branchAddress = getSiteConfig().branchAddress.trim();
            if (cart.length === 0) {
                return `
                    <div class="text-center py-20 bg-white rounded-2xl border border-slate-200">
                        <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                            <i class="fa-solid fa-cart-shopping"></i>
                        </div>
                        <h3 class="text-lg font-bold text-slate-800 mb-1">Tu carrito está vacío</h3>
                        <p class="text-sm text-slate-500 mb-6">Explora nuestro catálogo y añade productos increíbles.</p>
                        <button onclick="setCustomerTab('catalog')" class="px-6 py-2.5 bg-brand-600 text-white font-semibold rounded-xl text-sm shadow-md hover:bg-brand-700 transition">Ver Catálogo</button>
                    </div>
                `;
            }

            return `
                <div class="max-w-4xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                    <h2 class="text-2xl font-bold text-slate-900 mb-6">Carrito de Compras</h2>
                    <div class="divide-y divide-slate-100 mb-6">
                        ${cart.map((item, index) => `
                            <div class="py-4 flex items-center justify-between gap-4">
                                <div class="flex items-center gap-4">
                                    <img src="${item.image}" alt="${item.name}" class="w-16 h-16 object-cover rounded-xl border border-slate-100">
                                    <div>
                                        <h4 class="font-bold text-slate-900 text-sm">${item.name}</h4>
                                        <p class="text-xs text-slate-500">${formatCurrency(item.price)} c/u</p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-6">
                                    <div class="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                                        <button onclick="updateCartQty(${index}, -1)" class="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600">-</button>
                                        <span class="px-3 text-sm font-semibold text-slate-800">${item.qty}</span>
                                        <button onclick="updateCartQty(${index}, 1)" class="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600">+</button>
                                    </div>
                                    <span class="font-bold text-slate-900 w-20 text-right">${formatCurrency(item.price * item.qty)}</span>
                                    <button onclick="removeFromCart(${index})" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash-can"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div class="bg-slate-50 rounded-xl p-6 border border-slate-200 space-y-4">
                        <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div>
                                <p class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Total a pagar</p>
                                <h3 class="text-3xl font-bold text-slate-900">${formatCurrency(total)}</h3>
                            </div>
                            <button onclick="checkout()" class="w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/30 transition text-sm flex items-center justify-center gap-2">
                                <i class="fa-solid fa-shield-check"></i> Finalizar Compra
                            </button>
                        </div>
                        ${branchAddress ? `
                            <div class="border-t border-slate-200 pt-4">
                                <p class="text-sm font-semibold text-slate-800">Pago y retiro en sucursal</p>
                                <p class="text-sm text-slate-600 mt-1">${escapeHtml(branchAddress)}</p>
                                <a href="${escapeHtml(getGoogleMapsUrl(branchAddress))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-semibold mt-2">
                                    <i class="fa-solid fa-map-location-dot"></i> Abrir ubicación en Google Maps
                                </a>
                                <iframe
                                    title="Mapa de la sucursal o punto de retiro"
                                    src="${escapeHtml(getGoogleMapsEmbedUrl(branchAddress))}"
                                    class="w-full h-64 rounded-xl border border-slate-200 mt-3"
                                    loading="lazy"
                                    referrerpolicy="no-referrer-when-downgrade"
                                    allowfullscreen>
                                </iframe>
                            </div>
                        ` : '<p class="text-sm text-amber-700">La dirección de retiro aún no está configurada.</p>'}
                    </div>
                </div>
            `;
        }

        function updateCartQty(index, delta) {
            const cartItem = cart[index];
            if (!cartItem) return;

            if (delta > 0) {
                const product = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS)).find(item => item.id === cartItem.id);
                if (!product || cartItem.qty >= product.stock) {
                    showToast('Has alcanzado el límite de stock disponible', 'error');
                    return;
                }
            }

            cartItem.qty += delta;
            if (cartItem.qty <= 0) {
                cart.splice(index, 1);
            }
            renderApp();
        }

        function removeFromCart(index) {
            cart.splice(index, 1);
            renderApp();
            showToast('Producto eliminado del carrito');
        }

        let isCheckoutPending = false;
        let pendingCheckoutRequestId = '';

        async function checkout() {
            if (isCheckoutPending) return;
            const user = getCurrentUser();
            if (!user) {
                showToast('Inicia sesión para completar tu pedido', 'error');
                openLoginModal();
                return;
            }

            const branchAddress = getSiteConfig().branchAddress.trim();
            if (!branchAddress) {
                showToast('Administración debe configurar la dirección de la sucursal o punto de retiro.', 'error');
                return;
            }
            if (!sharedStorageEnabled) {
                showToast('No se pudo conectar con la base de datos. No se registró el pedido.', 'error');
                return;
            }

            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));

            const unavailableItems = cart.filter(cartItem => {
                const product = products.find(item => item.id === cartItem.id);
                return !product || product.stock < cartItem.qty;
            });
            if (unavailableItems.length > 0) {
                unavailableItems.forEach(cartItem => {
                    const product = products.find(item => item.id === cartItem.id);
                    if (!product || product.stock <= 0) {
                        cart = cart.filter(item => item.id !== cartItem.id);
                    } else {
                        cartItem.qty = product.stock;
                    }
                });
                renderApp();
                showToast('El stock cambió. Revisa las cantidades de tu carrito.', 'error');
                return;
            }

            const orderItems = cart.map(cartItem => {
                const product = products.find(item => item.id === cartItem.id);
                return {
                    ...cartItem,
                    price: roundAmount(cartItem.price),
                    cost: product && Number.isInteger(product.cost) ? product.cost : null
                };
            });
            if (!pendingCheckoutRequestId) {
                pendingCheckoutRequestId = window.crypto && window.crypto.randomUUID
                    ? window.crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            }

            isCheckoutPending = true;
            try {
                await sharedStorageWriteQueue;
                pendingSharedWrites++;
                try {
                    const response = await fetch('/api/orders', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: pendingCheckoutRequestId,
                            customerEmail: user.email,
                            items: orderItems.map(item => ({
                                id: item.id,
                                qty: item.qty
                            }))
                        })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'No se pudo registrar el pedido.');

                    nativeStorageSetItem.call(localStorage, STORAGE_KEYS.ORDERS, JSON.stringify(result.orders));
                    nativeStorageSetItem.call(localStorage, STORAGE_KEYS.PRODUCTS, JSON.stringify(result.products));
                    pendingCheckoutRequestId = '';
                    cart = [];
                    customerActiveTab = 'orders';
                    renderApp();
                    showToast('Pedido registrado. El pago se realizará en la sucursal o punto de retiro.');
                    printOrderReceipt(result.order);
                } finally {
                    pendingSharedWrites--;
                }
            } catch (error) {
                console.error('Error al registrar el pedido:', error);
                showToast(error.message || 'No se pudo registrar el pedido en la base de datos.', 'error');
            } finally {
                isCheckoutPending = false;
            }
        }

        function printOrderReceipt(order) {
            const receipt = document.getElementById('print-receipt');
            const siteName = escapeHtml(getSiteConfig().siteName);
            receipt.innerHTML = `
                <article style="max-width: 720px; margin: 0 auto;">
                    <h1 style="font-size: 24px; margin-bottom: 4px;">${siteName}</h1>
                    <h2 style="font-size: 20px; margin: 20px 0 12px;">Comprobante de pedido ${escapeHtml(order.id)}</h2>
                    <p>Fecha: ${escapeHtml(order.date)}</p>
                    <p>Cliente: ${escapeHtml(order.customer)}</p>
                    <p>Correo: ${escapeHtml(order.customerEmail)}</p>
                    <hr style="margin: 16px 0;">
                    ${order.items.map(item => `
                        <div style="display: flex; justify-content: space-between; gap: 16px; margin: 8px 0;">
                            <span>${escapeHtml(item.name)} (x${Number(item.qty)})</span>
                            <span>${formatCurrency(item.price * item.qty)}</span>
                        </div>
                    `).join('')}
                    <hr style="margin: 16px 0;">
                    <p style="font-size: 18px; font-weight: bold;">Total a pagar: ${formatCurrency(order.total)}</p>
                    <p>Pago: pendiente; se realiza en la sucursal o punto de retiro.</p>
                    <p>Dirección de retiro: ${escapeHtml(order.pickupAddress)}</p>
                    <p>Mapa: <a href="${escapeHtml(getGoogleMapsUrl(order.pickupAddress))}">${escapeHtml(getGoogleMapsUrl(order.pickupAddress))}</a></p>
                    <p>Estado del pedido: ${escapeHtml(order.status)}</p>
                </article>
            `;
            receipt.classList.remove('hidden');
            window.print();
            receipt.classList.add('hidden');
        }

        function renderCustomerOrders(orders) {
            return `
                <div class="max-w-4xl mx-auto">
                    <h2 class="text-2xl font-bold text-slate-900 mb-6">Historial de Mis Compras</h2>
                    ${orders.length === 0 ? `
                        <div class="text-center py-16 bg-white rounded-2xl border border-slate-200">
                            <p class="text-slate-500 text-sm">Aún no has realizado ninguna compra.</p>
                        </div>
                    ` : `
                        <div class="space-y-4">
                            ${orders.map(ord => `
                                <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-4 border-b border-slate-100">
                                        <div>
                                            <span class="font-bold text-slate-900 text-base">${ord.id}</span>
                                            <span class="text-xs text-slate-400 ml-3">${ord.date}</span>
                                        </div>
                                        <span class="px-3 py-1 rounded-full text-xs font-semibold w-fit ${
                                            ord.status === 'Pendiente' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                            ord.status === 'Preparando' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' :
                                            ord.status === 'Enviado' ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                        }">${ord.status}</span>
                                    </div>
                                    <div class="space-y-2 mb-4">
                                        ${ord.items.map(item => `
                                            <div class="flex justify-between text-sm text-slate-600">
                                                <span>${item.name} (x${item.qty})</span>
                                                <span class="font-semibold">${formatCurrency(item.price * item.qty)}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                    <div class="flex justify-between items-center pt-3 border-t border-slate-100">
                                        <span class="text-xs text-slate-400 font-medium uppercase">${ord.paymentMethod ? 'Total pendiente de pago' : 'Total abonado'}</span>
                                        <span class="font-bold text-slate-900 text-lg">${formatCurrency(ord.total)}</span>
                                    </div>
                                    ${ord.pickupAddress ? `
                                        <p class="text-xs text-slate-500 mt-2">Pago y retiro en sucursal: ${escapeHtml(ord.pickupAddress)}</p>
                                        <a href="${escapeHtml(getGoogleMapsUrl(ord.pickupAddress))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold mt-2">
                                            <i class="fa-solid fa-map-location-dot"></i> Abrir ubicación en Google Maps
                                        </a>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            `;
        }

        function attachCustomerEvents() {
            const searchInput = document.getElementById('product-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    const cards = document.querySelectorAll('#product-grid > div');
                    cards.forEach(card => {
                        const title = card.querySelector('h3').textContent.toLowerCase();
                        card.style.display = title.includes(term) ? 'flex' : 'none';
                    });
                });
            }
        }

        function renderEmployeeLayout(user) {
            const orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS));
            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));

            return `
                <div class="min-h-full flex flex-col bg-slate-50">
                    <header class="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
                        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-amber-500/20">
                                    <i class="fa-solid fa-user-tie"></i>
                                </div>
                                <div>
                                    <span class="font-bold text-slate-900 text-base">Portal de Empleado</span>
                                    <span class="block text-[10px] text-amber-600 font-semibold uppercase">Logística y Catálogo</span>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="text-xs font-semibold text-slate-700 hidden sm:inline">${escapeHtml(user.name)}</span>
                                <button onclick="logout()" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition" title="Cerrar Sesión">
                                    <i class="fa-solid fa-power-off"></i>
                                </button>
                            </div>
                        </div>
                    </header>

                    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
                        <div>
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                <div>
                                    <h2 class="text-2xl font-bold text-slate-900">Inventario y Altas de Productos</h2>
                                    <p class="text-sm text-slate-500">Como empleado, puedes registrar nuevos productos y actualizar el stock disponible.</p>
                                </div>
                                <button onclick="openProductModal()" class="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-amber-600/30 transition flex items-center gap-2">
                                    <i class="fa-solid fa-plus"></i> Nuevo Producto
                                </button>
                            </div>

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left border-collapse text-sm">
                                        <thead>
                                            <tr class="bg-slate-50 text-slate-400 font-semibold text-xs uppercase tracking-wider border-b border-slate-200">
                                                <th class="p-4">Imagen</th>
                                                <th class="p-4">Nombre</th>
                                                <th class="p-4">Categoría</th>
                                                <th class="p-4">Precio de venta</th>
                                                <th class="p-4">Costo de compra</th>
                                                <th class="p-4">Existencias</th>
                                                <th class="p-4 text-right">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-slate-100 text-slate-700">
                                            ${products.map(p => `
                                                <tr class="hover:bg-slate-50/50 transition">
                                                    <td class="p-4">
                                                        <img src="${p.image}" alt="${p.name}" class="w-12 h-12 object-cover rounded-xl border border-slate-100" onerror="this.src='https://placehold.co/100x100/e2e8f0/64748b?text=Img'">
                                                    </td>
                                                    <td class="p-4 font-bold text-slate-900">${p.name}</td>
                                                    <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">${p.category}</span></td>
                                                    <td class="p-4 font-semibold text-slate-900">${formatCurrency(p.price)}</td>
                                                    <td class="p-4 text-slate-600">${Number.isInteger(p.cost) ? formatCurrency(p.cost) : 'Sin registrar'}</td>
                                                    <td class="p-4"><span class="px-2.5 py-1 rounded-lg text-xs font-semibold ${p.stock > 5 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}">${p.stock} un.</span></td>
                                                    <td class="p-4 text-right space-x-2">
                                                        <button onclick="editProduct(${p.id})" class="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition" title="Editar existencias y datos"><i class="fa-solid fa-pen-to-square"></i></button>
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div class="mb-6">
                                <h2 class="text-2xl font-bold text-slate-900">Gestión de Pedidos de Clientes</h2>
                                <p class="text-sm text-slate-500">Actualiza el estado de los pedidos a medida que se procesan en almacén.</p>
                            </div>

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left border-collapse text-sm">
                                        <thead>
                                            <tr class="bg-slate-50 text-slate-400 font-semibold text-xs uppercase tracking-wider border-b border-slate-200">
                                                <th class="p-4">Pedido ID</th>
                                                <th class="p-4">Cliente</th>
                                                <th class="p-4">Detalle Items</th>
                                                <th class="p-4">Total</th>
                                                <th class="p-4">Fecha</th>
                                                <th class="p-4">Estado Actual</th>
                                                <th class="p-4 text-right">Acciones / Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-slate-100 text-slate-700">
                                            ${orders.map(ord => `
                                                <tr class="hover:bg-slate-50/50 transition">
                                                    <td class="p-4 font-bold text-slate-900">${ord.id}</td>
                                                    <td class="p-4 font-medium">${escapeHtml(ord.customer)}</td>
                                                    <td class="p-4 text-xs text-slate-500 max-w-xs truncate">
                                                        ${ord.items.map(i => `${i.qty}x ${i.name}`).join(', ')}
                                                    </td>
                                                    <td class="p-4 font-semibold text-slate-900">${formatCurrency(ord.total)}</td>
                                                    <td class="p-4 text-xs text-slate-400">${ord.date}</td>
                                                    <td class="p-4">
                                                        <span class="px-3 py-1 rounded-full text-xs font-semibold ${
                                                            ord.status === 'Pendiente' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                                            ord.status === 'Preparando' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' :
                                                            ord.status === 'Enviado' ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                                        }">${ord.status}</span>
                                                    </td>
                                                    <td class="p-4 text-right">
                                                        <select onchange="updateOrderStatus('${ord.id}', this.value)" class="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none">
                                                            <option value="Pendiente" ${ord.status === 'Pendiente' ? 'selected' : ''}>Pendiente</option>
                                                            <option value="Preparando" ${ord.status === 'Preparando' ? 'selected' : ''}>Preparando</option>
                                                            <option value="Enviado" ${ord.status === 'Enviado' ? 'selected' : ''}>Enviado</option>
                                                            <option value="Entregado" ${ord.status === 'Entregado' ? 'selected' : ''}>Entregado</option>
                                                        </select>
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </main>

                    ${renderProductModal()}

                    <footer class="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
                        &copy; 2026 ${escapeHtml(getSiteConfig().siteName)}. Consola de Empleados.
                    </footer>
                </div>
            `;
        }

        function attachEmployeeEvents() {
            attachAdminEvents();
        }

        let adminActiveTab = 'dashboard';

        function renderAdminLayout(user) {
            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
            const orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS));
            const archivedOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS));
            const allOrders = [...orders, ...archivedOrders];
            const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS));

            return `
                <div class="min-h-full flex flex-col bg-slate-50">
                    <header class="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
                        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-brand-500/20">
                                    <i class="fa-solid fa-user-shield"></i>
                                </div>
                                <div>
                                    <span class="font-bold text-slate-900 text-base">Consola de Administración</span>
                                    <span class="block text-[10px] text-brand-600 font-semibold uppercase">Gestión Global</span>
                                </div>
                            </div>
                            <nav class="hidden md:flex items-center gap-6 text-sm font-medium">
                                <button onclick="setAdminTab('dashboard')" class="${adminActiveTab === 'dashboard' ? 'text-brand-600 font-semibold' : 'text-slate-600 hover:text-slate-900'} transition">Resumen</button>
                                <button onclick="setAdminTab('products')" class="${adminActiveTab === 'products' ? 'text-brand-600 font-semibold' : 'text-slate-600 hover:text-slate-900'} transition">Productos</button>
                                <button onclick="setAdminTab('orders')" class="${adminActiveTab === 'orders' ? 'text-brand-600 font-semibold' : 'text-slate-600 hover:text-slate-900'} transition">Pedidos</button>
                                <button onclick="setAdminTab('users')" class="${adminActiveTab === 'users' ? 'text-brand-600 font-semibold' : 'text-slate-600 hover:text-slate-900'} transition">Usuarios y Roles</button>
                                <button onclick="setAdminTab('customizer')" class="${adminActiveTab === 'customizer' ? 'text-brand-600 font-semibold border-b-2 border-brand-600 pb-1' : 'text-slate-600 hover:text-slate-900'} transition flex items-center gap-1.5"><i class="fa-solid fa-palette text-xs"></i> Apariencia y estructura</button>
                            </nav>
                            <div class="flex items-center gap-3">
                                <span class="text-xs font-semibold text-slate-700 hidden sm:inline">${escapeHtml(user.name)}</span>
                                <button onclick="logout()" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition" title="Cerrar Sesión">
                                    <i class="fa-solid fa-power-off"></i>
                                </button>
                            </div>
                        </div>
                        <div class="md:hidden px-4 pb-3">
                            <label for="admin-mobile-tab" class="sr-only">Sección de administración</label>
                            <select id="admin-mobile-tab" onchange="setAdminTab(this.value)" class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
                                <option value="dashboard" ${adminActiveTab === 'dashboard' ? 'selected' : ''}>Resumen</option>
                                <option value="products" ${adminActiveTab === 'products' ? 'selected' : ''}>Productos</option>
                                <option value="orders" ${adminActiveTab === 'orders' ? 'selected' : ''}>Pedidos</option>
                                <option value="users" ${adminActiveTab === 'users' ? 'selected' : ''}>Usuarios y Roles</option>
                                <option value="customizer" ${adminActiveTab === 'customizer' ? 'selected' : ''}>Apariencia y Estructura</option>
                            </select>
                        </div>
                    </header>

                    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
                        ${adminActiveTab === 'dashboard' ? renderAdminDashboard(products, allOrders, users) : ''}
                        ${adminActiveTab === 'products' ? renderAdminProducts(products) : ''}
                        ${adminActiveTab === 'orders' ? renderAdminOrders(orders, archivedOrders) : ''}
                        ${adminActiveTab === 'users' ? renderAdminUsers(users) : ''}
                        ${adminActiveTab === 'customizer' ? renderAdminCustomizer() : ''}
                    </main>

                    ${renderProductModal()}

                    <footer class="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
                        &copy; 2026 ${escapeHtml(getSiteConfig().siteName)}. Todos los derechos reservados.
                    </footer>
                </div>
            `;
        }

        function setAdminTab(tab) {
            adminActiveTab = tab;
            renderApp();
        }

        function getOrderProfit(order) {
            const items = Array.isArray(order.items) ? order.items : [];
            if (items.length === 0 || items.some(item => !Number.isInteger(item.cost))) return null;
            return items.reduce((sum, item) => {
                const quantity = Math.max(0, Number(item.qty) || 0);
                return sum + (roundAmount(item.price) - item.cost) * quantity;
            }, 0);
        }

        function renderAdminDashboard(products, orders, users) {
            const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
            const ordersWithProfit = orders.filter(order => getOrderProfit(order) !== null).length;
            const totalProfit = orders.reduce((sum, order) => {
                const profit = getOrderProfit(order);
                return sum + (profit === null ? 0 : profit);
            }, 0);
            const averageSale = orders.length ? roundAmount(totalSales / orders.length) : 0;
            const productsMissingCost = products.filter(product => !Number.isInteger(product.cost)).length;
            const lowStockProducts = products.filter(p => p.stock <= 5);
            const now = new Date();
            const months = [];
            for (let offset = 5; offset >= 0; offset--) {
                const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
                months.push({
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    label: new Intl.DateTimeFormat('es', { month: 'short' }).format(date),
                    income: 0,
                    profit: null
                });
            }
            orders.forEach(order => {
                const dateMatch = String(order.deliveredAt || order.date || '').match(/^(\d{4})-(\d{2})/);
                if (!dateMatch) return;
                const month = months.find(entry => entry.year === Number(dateMatch[1]) && entry.month === Number(dateMatch[2]));
                if (!month) return;
                month.income += Number(order.total || 0);
                const profit = getOrderProfit(order);
                if (profit !== null) month.profit = (month.profit || 0) + profit;
            });

            const maxChartValue = Math.max(1, ...months.map(month => Math.max(month.income, Math.abs(month.profit || 0))));
            const chartScale = 100 / maxChartValue;
            const chartBars = months.map((month, index) => {
                const x = 48 + index * 112;
                const incomeHeight = month.income > 0 ? Math.max(1, month.income * chartScale) : 0;
                const profitHeight = month.profit === null || month.profit === 0 ? 0 : Math.max(1, Math.abs(month.profit) * chartScale);
                const profitY = month.profit > 0 ? 190 - profitHeight : 190;
                return `
                    <g>
                        <rect x="${x}" y="${190 - incomeHeight}" width="28" height="${incomeHeight}" rx="4" fill="#4f46e5">
                            <title>Ingresos ${month.label}: ${formatCurrency(month.income)}</title>
                        </rect>
                        ${month.profit === null ? '' : `<rect x="${x + 34}" y="${profitY}" width="28" height="${profitHeight}" rx="4" fill="#059669"><title>Ganancias ${month.label}: ${formatCurrency(month.profit)}</title></rect>`}
                        <text x="${x + 30}" y="320" text-anchor="middle" fill="#64748b" font-size="12">${month.label}</text>
                    </g>
                `;
            }).join('');

            return `
                <div class="space-y-8">
                    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Ingresos totales</p>
                            <h3 class="text-3xl font-extrabold text-slate-900">${formatCurrency(totalSales)}</h3>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Ganancia bruta registrada</p>
                            <h3 class="text-3xl font-extrabold text-slate-900">${ordersWithProfit ? formatCurrency(totalProfit) : 'Sin datos'}</h3>
                            <p class="text-xs text-slate-500 mt-1">${ordersWithProfit} de ${orders.length} pedidos con costo registrado</p>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Promedio por venta</p>
                            <h3 class="text-3xl font-extrabold text-slate-900">${formatCurrency(averageSale)}</h3>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Pedidos registrados</p>
                            <h3 class="text-3xl font-extrabold text-slate-900">${orders.length}</h3>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Productos en catálogo</p>
                            <h3 class="text-3xl font-extrabold text-slate-900">${products.length}</h3>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Usuarios activos</p>
                            <h3 class="text-3xl font-extrabold text-slate-900">${users.filter(user => user.status === 'active').length}</h3>
                        </div>
                    </div>

                    <section class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                            <div>
                                <h2 class="text-lg font-bold text-slate-900">Balance de ingresos y ganancias</h2>
                                <p class="text-sm text-slate-500">Comparación mensual de los últimos seis meses.</p>
                            </div>
                            <div class="flex flex-wrap gap-4 text-xs font-medium">
                                <span class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm bg-indigo-600"></span>Ingresos</span>
                                <span class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm bg-emerald-600"></span>Ganancias con costo registrado</span>
                            </div>
                        </div>
                        <div class="w-full overflow-x-auto">
                            <svg viewBox="0 0 720 340" role="img" aria-label="Gráfico mensual de ingresos y ganancias" class="w-full min-w-[600px] h-72">
                                <line x1="30" y1="190" x2="700" y2="190" stroke="#cbd5e1" stroke-width="1"></line>
                                <line x1="30" y1="140" x2="700" y2="140" stroke="#e2e8f0" stroke-width="1"></line>
                                <line x1="30" y1="90" x2="700" y2="90" stroke="#e2e8f0" stroke-width="1"></line>
                                ${chartBars}
                            </svg>
                        </div>
                        <p class="text-xs text-slate-500 mt-2">La ganancia bruta se calcula restando el costo de compra al precio de venta. No incluye otros gastos. Los pedidos antiguos sin costo guardado no se incluyen en las ganancias.</p>
                    </section>

                    <div class="flex flex-wrap gap-3">
                        <button onclick="setAdminTab('orders')" class="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold transition">
                            <i class="fa-solid fa-box mr-2"></i>Gestionar pedidos
                        </button>
                        <button onclick="setAdminTab('users')" class="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition">
                            <i class="fa-solid fa-users mr-2"></i>Gestionar usuarios
                        </button>
                    </div>

                    ${productsMissingCost > 0 ? `
                        <div class="bg-sky-50 border border-sky-200 rounded-2xl p-5 text-sky-900">
                            <p class="text-sm font-semibold">Falta registrar el costo de compra de ${productsMissingCost} producto(s).</p>
                            <p class="text-xs mt-1">Edita esos productos para calcular las ganancias de los próximos pedidos.</p>
                            <button onclick="setAdminTab('products')" class="mt-3 text-xs font-semibold underline">Ir a productos</button>
                        </div>
                    ` : ''}

                    ${lowStockProducts.length > 0 ? `
                        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-900">
                            <h3 class="font-bold text-base mb-2 flex items-center gap-2">
                                <i class="fa-solid fa-triangle-exclamation text-amber-600"></i> Alerta de existencias bajas
                            </h3>
                            <p class="text-xs text-amber-700 mb-4">Los siguientes productos tienen 5 unidades o menos en inventario:</p>
                            <ul class="list-disc list-inside text-xs space-y-1">
                                ${lowStockProducts.map(p => `<li><b>${p.name}</b> - Quedan ${p.stock} unidades.</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        function summarizeOrders(orders) {
            const profitOrders = orders.filter(order => getOrderProfit(order) !== null).length;
            const profit = orders.reduce((sum, order) => {
                const orderProfit = getOrderProfit(order);
                return sum + (orderProfit === null ? 0 : orderProfit);
            }, 0);
            const income = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
            return {
                count: orders.length,
                income,
                profit,
                profitOrders,
                average: orders.length ? roundAmount(income / orders.length) : 0
            };
        }

        function escapeCsv(value) {
            let text = value === null || value === undefined ? '' : String(value);
            if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        }

        function getMonthlyArchivedOrders(month) {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS))
                .filter(order => getOrderMonthValue(order) === month)
                .sort((first, second) => String(second.deliveredAt || '').localeCompare(String(first.deliveredAt || '')));
        }

        function updateMonthlyOrderReportSummary() {
            const monthInput = document.getElementById('admin-report-month');
            if (!monthInput || !/^\d{4}-\d{2}$/.test(monthInput.value)) return;
            const summary = summarizeOrders(getMonthlyArchivedOrders(monthInput.value));
            document.getElementById('monthly-report-count').textContent = summary.count;
            document.getElementById('monthly-report-income').textContent = formatCurrency(summary.income);
            document.getElementById('monthly-report-profit').textContent = summary.profitOrders ? formatCurrency(summary.profit) : 'Sin datos';
            document.getElementById('monthly-report-average').textContent = formatCurrency(summary.average);
        }

        function downloadMonthlyOrderReport() {
            const monthInput = document.getElementById('admin-report-month');
            const month = monthInput ? monthInput.value : '';
            if (!/^\d{4}-\d{2}$/.test(month)) {
                showToast('Selecciona un mes válido para descargar el informe.', 'error');
                return;
            }

            const orders = getMonthlyArchivedOrders(month);
            const summary = summarizeOrders(orders);
            const rows = [
                ['Historial mensual de pedidos entregados', month],
                ['Pedidos entregados', summary.count],
                ['Ingresos totales', roundAmount(summary.income)],
                ['Ganancia bruta registrada', summary.profitOrders ? roundAmount(summary.profit) : 'Sin datos de costos'],
                ['Promedio por pedido', roundAmount(summary.average)],
                ['Pedidos con costos registrados', summary.profitOrders],
                ['Pedidos sin costos completos', summary.count - summary.profitOrders],
                [],
                ['Resumen por pedido'],
                ['Pedido', 'Cliente', 'Fecha del pedido', 'Fecha de entrega', 'Productos', 'Total', 'Ganancia bruta'],
                ...orders.map(order => {
                    const profit = getOrderProfit(order);
                    return [
                        order.id,
                        order.customer,
                        order.date || '',
                        order.deliveredAt || '',
                        (order.items || []).map(item => `${item.qty} x ${item.name}`).join(', '),
                        roundAmount(order.total),
                        profit === null ? 'Sin costos completos' : roundAmount(profit)
                    ];
                }),
                [],
                ['Detalle de productos'],
                ['Pedido', 'Producto', 'Cantidad', 'Precio de venta', 'Costo de compra', 'Ganancia de la línea'],
                ...orders.flatMap(order => (order.items || []).map(item => {
                    const hasCost = Number.isInteger(item.cost);
                    const profit = hasCost ? (roundAmount(item.price) - item.cost) * (Number(item.qty) || 0) : 'Sin costo registrado';
                    return [
                        order.id,
                        item.name,
                        Number(item.qty) || 0,
                        roundAmount(item.price),
                        hasCost ? item.cost : 'Sin costo registrado',
                        profit
                    ];
                }))
            ];
            const csv = '\uFEFF' + rows.map(row => row.map(escapeCsv).join(';')).join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `historial-pedidos-${month}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast(`Informe de pedidos de ${month} descargado.`);
        }

        function renderAdminOrders(orders, archivedOrders) {
            const statuses = ['Pendiente', 'Preparando', 'Enviado', 'Entregado'];
            const allOrders = [...orders, ...archivedOrders];
            const month = getLocalMonthValue();
            const monthlySummary = summarizeOrders(archivedOrders.filter(order => getOrderMonthValue(order) === month));
            const statusClass = status => ({
                Pendiente: 'bg-amber-50 text-amber-600 border-amber-200',
                Preparando: 'bg-indigo-50 text-indigo-600 border-indigo-200',
                Enviado: 'bg-blue-50 text-blue-600 border-blue-200',
                Entregado: 'bg-emerald-50 text-emerald-600 border-emerald-200'
            })[status] || 'bg-slate-50 text-slate-600 border-slate-200';

            return `
                <div class="space-y-6">
                    <div>
                        <h2 class="text-2xl font-bold text-slate-900">Gestión de Pedidos</h2>
                        <p class="text-sm text-slate-500">Administra los pedidos activos. Al marcar uno como entregado, se archiva automáticamente en el historial mensual.</p>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="bg-white p-5 rounded-2xl border border-slate-200">
                            <p class="text-xs font-semibold text-slate-400 uppercase">Pedidos activos</p>
                            <p class="text-2xl font-bold text-slate-900">${orders.length}</p>
                        </div>
                        <div class="bg-white p-5 rounded-2xl border border-slate-200">
                            <p class="text-xs font-semibold text-slate-400 uppercase">Pendientes</p>
                            <p class="text-2xl font-bold text-amber-600">${orders.filter(order => order.status === 'Pendiente').length}</p>
                        </div>
                        <div class="bg-white p-5 rounded-2xl border border-slate-200">
                            <p class="text-xs font-semibold text-slate-400 uppercase">Ingresos acumulados</p>
                            <p class="text-2xl font-bold text-slate-900">${formatCurrency(allOrders.reduce((sum, order) => sum + Number(order.total || 0), 0))}</p>
                        </div>
                    </div>
                    <section class="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-4">
                        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                            <div>
                                <h3 class="font-bold text-slate-900">Historial mensual de pedidos entregados</h3>
                                <p class="text-xs text-slate-600 mt-1">El informe descargable incluye ingresos, ganancias registradas, promedio y detalle de cada pedido.</p>
                            </div>
                            <div class="flex flex-col sm:flex-row gap-3">
                                <label class="sr-only" for="admin-report-month">Mes del informe</label>
                                <input id="admin-report-month" type="month" value="${month}" class="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
                                <button onclick="downloadMonthlyOrderReport()" class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition">
                                    <i class="fa-solid fa-download mr-2"></i>Descargar resumen mensual
                                </button>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div class="bg-white/80 p-3 rounded-xl"><p class="text-xs text-slate-500">Pedidos entregados</p><p id="monthly-report-count" class="font-bold text-slate-900">${monthlySummary.count}</p></div>
                            <div class="bg-white/80 p-3 rounded-xl"><p class="text-xs text-slate-500">Ingresos del mes</p><p id="monthly-report-income" class="font-bold text-slate-900">${formatCurrency(monthlySummary.income)}</p></div>
                            <div class="bg-white/80 p-3 rounded-xl"><p class="text-xs text-slate-500">Ganancia bruta</p><p id="monthly-report-profit" class="font-bold text-slate-900">${monthlySummary.profitOrders ? formatCurrency(monthlySummary.profit) : 'Sin datos'}</p></div>
                            <div class="bg-white/80 p-3 rounded-xl"><p class="text-xs text-slate-500">Promedio por pedido</p><p id="monthly-report-average" class="font-bold text-slate-900">${formatCurrency(monthlySummary.average)}</p></div>
                        </div>
                        <p class="text-xs text-slate-600">Ganancias calculadas solo para pedidos con costo guardado; no incluyen otros gastos.</p>
                    </section>
                    <div class="flex flex-col sm:flex-row gap-3">
                        <input id="admin-order-search" type="search" placeholder="Buscar por pedido o cliente..." class="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm">
                        <select id="admin-order-status-filter" class="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm">
                            <option value="">Todos los estados</option>
                            ${statuses.map(status => `<option value="${status}">${status}</option>`).join('')}
                        </select>
                    </div>
                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead>
                                    <tr class="bg-slate-50 text-slate-400 text-xs uppercase border-b border-slate-200">
                                        <th class="p-4">Pedido</th><th class="p-4">Cliente</th><th class="p-4">Productos</th>
                                        <th class="p-4">Total</th><th class="p-4">Fecha</th><th class="p-4">Estado</th><th class="p-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody id="admin-order-rows" class="divide-y divide-slate-100">
                                    ${orders.map(order => `
                                        <tr data-order-row data-order-id="${escapeHtml(order.id)}" data-order-customer="${escapeHtml(order.customer)}" data-order-status="${escapeHtml(order.status)}">
                                            <td class="p-4 font-bold">${escapeHtml(order.id)}</td>
                                            <td class="p-4">${escapeHtml(order.customer)}</td>
                                            <td class="p-4 text-xs text-slate-500">${(order.items || []).map(item => `${Number(item.qty) || 0}x ${escapeHtml(item.name)}`).join(', ')}</td>
                                            <td class="p-4 font-semibold">${formatCurrency(order.total)}</td>
                                            <td class="p-4 text-xs text-slate-500">${escapeHtml(order.date || '')}</td>
                                            <td class="p-4">
                                                <select data-order-status data-order-id="${escapeHtml(order.id)}" class="px-3 py-2 rounded-xl border ${statusClass(order.status)} text-xs font-semibold">
                                                    ${statuses.map(status => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                                                </select>
                                            </td>
                                            <td class="p-4 text-right">
                                                <button type="button" data-delete-order data-order-id="${escapeHtml(order.id)}" aria-label="Eliminar pedido ${escapeHtml(order.id)}" title="Eliminar pedido activo" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition">
                                                    <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('') || '<tr><td colspan="7" class="p-8 text-center text-slate-400">Todavía no hay pedidos registrados.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                        <p id="admin-order-empty-filter" class="hidden p-6 text-center text-sm text-slate-400">No hay pedidos que coincidan con la búsqueda.</p>
                    </div>
                </div>
            `;
        }

        function renderAdminProducts(products) {
            return `
                <div class="space-y-6">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h2 class="text-2xl font-bold text-slate-900">Gestión de Productos</h2>
                            <p class="text-sm text-slate-500">Crea, edita o elimina productos del catálogo general.</p>
                        </div>
                        <button onclick="openProductModal()" class="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-sm shadow-md transition flex items-center gap-2">
                            <i class="fa-solid fa-plus"></i> Nuevo Producto
                        </button>
                    </div>

                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr class="bg-slate-50 text-slate-400 font-semibold text-xs uppercase tracking-wider border-b border-slate-200">
                                        <th class="p-4">Imagen</th>
                                        <th class="p-4">Nombre</th>
                                        <th class="p-4">Categoría</th>
                                        <th class="p-4">Precio de venta</th>
                                        <th class="p-4">Costo de compra</th>
                                        <th class="p-4">Existencias</th>
                                        <th class="p-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 text-slate-700">
                                    ${products.map(p => `
                                        <tr class="hover:bg-slate-50/50 transition">
                                            <td class="p-4">
                                                <img src="${p.image}" alt="${p.name}" class="w-12 h-12 object-cover rounded-xl border border-slate-100" onerror="this.src='https://placehold.co/100x100/e2e8f0/64748b?text=Img'">
                                            </td>
                                            <td class="p-4 font-bold text-slate-900">${p.name}</td>
                                            <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">${p.category}</span></td>
                                            <td class="p-4 font-semibold text-slate-900">${formatCurrency(p.price)}</td>
                                            <td class="p-4 text-slate-600">${Number.isInteger(p.cost) ? formatCurrency(p.cost) : 'Sin registrar'}</td>
                                            <td class="p-4"><span class="px-2.5 py-1 rounded-lg text-xs font-semibold ${p.stock > 5 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}">${p.stock} un.</span></td>
                                            <td class="p-4 text-right space-x-2">
                                                <button onclick="editProduct(${p.id})" class="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                                                <button onclick="deleteProduct(${p.id})" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderWhatsappContactRow(contact = {}, index = 0) {
            return `
                <div data-contact-row="whatsapp" class="rounded-xl border border-slate-200 p-4 space-y-3">
                    <div class="flex items-center justify-between gap-3">
                        <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <input type="checkbox" data-contact-enabled ${contact.enabled !== false ? 'checked' : ''} class="h-4 w-4 rounded text-brand-600">
                            Mostrar en el menú
                        </label>
                        <button type="button" onclick="this.closest('[data-contact-row]').remove()" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50">
                            <i class="fa-solid fa-trash-can mr-1"></i> Quitar
                        </button>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label class="block text-xs font-semibold text-slate-700">
                            Nombre
                            <input type="text" data-contact-label maxlength="40" value="${escapeHtml(contact.label || `WhatsApp ${index + 1}`)}" class="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="WhatsApp">
                        </label>
                        <label class="block text-xs font-semibold text-slate-700">
                            Número con código de país
                            <input type="tel" data-contact-number maxlength="30" value="${escapeHtml(contact.number || '')}" class="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="+54 9 11 1234 5678">
                        </label>
                    </div>
                </div>
            `;
        }

        function renderSocialLinkRow(link = {}) {
            return `
                <div data-contact-row="social" class="rounded-xl border border-slate-200 p-4 space-y-3">
                    <div class="flex items-center justify-between gap-3">
                        <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <input type="checkbox" data-contact-enabled ${link.enabled !== false ? 'checked' : ''} class="h-4 w-4 rounded text-brand-600">
                            Mostrar en el menú
                        </label>
                        <button type="button" onclick="this.closest('[data-contact-row]').remove()" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50">
                            <i class="fa-solid fa-trash-can mr-1"></i> Quitar
                        </button>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label class="block text-xs font-semibold text-slate-700">
                            Red social
                            <input type="text" data-contact-name maxlength="40" value="${escapeHtml(link.name || '')}" class="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Instagram">
                        </label>
                        <label class="block text-xs font-semibold text-slate-700">
                            Enlace
                            <input type="url" data-contact-url maxlength="2048" value="${escapeHtml(link.url || '')}" class="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="https://instagram.com/tu-tienda">
                        </label>
                    </div>
                </div>
            `;
        }

        function addContactEntry(type) {
            const list = document.getElementById(`cfg-${type}-list`);
            if (!list || (type !== 'whatsapp' && type !== 'social')) return;
            const index = Number(list.dataset.nextIndex) || 0;
            list.dataset.nextIndex = String(index + 1);
            list.insertAdjacentHTML('beforeend', type === 'whatsapp'
                ? renderWhatsappContactRow({}, index)
                : renderSocialLinkRow());
        }

        function renderAdminCustomizer() {
            const config = getSiteConfig();

            return `
                <div class="space-y-8 max-w-5xl mx-auto">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
                        <div>
                            <h2 class="text-2xl font-bold text-slate-900">Personalización Visual y Estructura Principal</h2>
                            <p class="text-sm text-slate-500">Edita colores, banners, textos del catálogo y la disposición general de la página de inicio.</p>
                        </div>
                        <button onclick="handleSaveConfig()" class="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-sm shadow-lg shadow-brand-600/30 transition flex items-center gap-2">
                            <i class="fa-solid fa-floppy-disk"></i> Guardar Cambios
                        </button>
                    </div>

                    <form id="customizer-form" class="space-y-8" onsubmit="event.preventDefault(); handleSaveConfig();">
                        
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                <i class="fa-solid fa-store text-brand-600"></i> Nombre de la Tienda
                            </h3>
                            <div>
                                <label for="cfg-siteName" class="block text-xs font-semibold text-slate-700 mb-2">Nombre que verán los clientes</label>
                                <input type="text" id="cfg-siteName" value="${escapeHtml(config.siteName)}" required maxlength="40" class="w-full max-w-md px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none" placeholder="Tienda">
                            </div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                <i class="fa-solid fa-location-dot text-brand-600"></i> Retiro en sucursal e inicio de sesión Google
                            </h3>
                            <div>
                                <label for="cfg-branchAddress" class="block text-xs font-semibold text-slate-700 mb-2">Dirección de la sucursal o punto de retiro</label>
                                <textarea id="cfg-branchAddress" rows="2" maxlength="300" class="w-full max-w-2xl px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none" placeholder="Dirección que aparecerá en el comprobante">${escapeHtml(config.branchAddress)}</textarea>
                                <p class="text-xs text-slate-500 mt-1">Es obligatorio configurarla antes de aceptar pedidos. Los clientes verán el mapa y el enlace de Google Maps generado con esta dirección.</p>
                            </div>
                            <div>
                                <label for="cfg-googleClientId" class="block text-xs font-semibold text-slate-700 mb-2">Google OAuth Client ID para clientes</label>
                                <input type="text" id="cfg-googleClientId" value="${escapeHtml(config.googleClientId)}" maxlength="300" class="w-full max-w-2xl px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none" placeholder="1234567890-abc.apps.googleusercontent.com">
                                <p class="text-xs text-slate-500 mt-1">Crea un ID de cliente OAuth web en Google Cloud y autoriza el origen de esta tienda (por ejemplo, http://127.0.0.1:8000).</p>
                            </div>
                        </div>

                        <section class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6" aria-labelledby="cfg-contact-heading">
                            <div>
                                <h3 id="cfg-contact-heading" class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                    <i class="fa-solid fa-address-book text-brand-600"></i> Contacto y redes
                                </h3>
                                <p class="text-sm text-slate-500 mt-1">Agrega los datos que quieres mostrar en el menú de la tienda y activa o desactiva cada contacto.</p>
                            </div>
                            <div class="space-y-4">
                                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <h4 class="font-semibold text-sm text-slate-800">Números de WhatsApp</h4>
                                        <p class="text-xs text-slate-500">Incluye el código de país para abrir el chat correctamente.</p>
                                    </div>
                                    <button type="button" onclick="addContactEntry('whatsapp')" class="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold">
                                        <i class="fa-solid fa-plus mr-1"></i> Agregar número
                                    </button>
                                </div>
                                <div id="cfg-whatsapp-list" data-next-index="${config.whatsappContacts.length}" class="space-y-3">
                                    ${config.whatsappContacts.map((contact, index) => renderWhatsappContactRow(contact, index)).join('')}
                                </div>
                            </div>
                            <div class="border-t border-slate-100 pt-5 space-y-4">
                                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <h4 class="font-semibold text-sm text-slate-800">Redes sociales y otros enlaces</h4>
                                        <p class="text-xs text-slate-500">Solo se mostrarán los enlaces habilitados.</p>
                                    </div>
                                    <button type="button" onclick="addContactEntry('social')" class="px-4 py-2 rounded-xl bg-brand-50 text-brand-700 hover:bg-brand-100 text-xs font-semibold">
                                        <i class="fa-solid fa-plus mr-1"></i> Agregar red o enlace
                                    </button>
                                </div>
                                <div id="cfg-social-list" data-next-index="${config.socialLinks.length}" class="space-y-3">
                                    ${config.socialLinks.map(link => renderSocialLinkRow(link)).join('')}
                                </div>
                            </div>
                        </section>

                        <!-- SECCIÓN 1: COLORES & TEMA -->
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                <i class="fa-solid fa-swatchbook text-brand-600"></i> Paleta de Colores y Marca
                            </h3>
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-2">Color Principal de Marca</label>
                                    <div class="flex items-center gap-3">
                                        <input type="color" id="cfg-brandColor" value="${config.brandColor}" class="w-12 h-10 rounded-xl border border-slate-300 p-1 cursor-pointer">
                                        <span class="text-xs font-mono text-slate-600 uppercase" id="cfg-brandColor-val">${config.brandColor}</span>
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-2">Degradado del banner (desde)</label>
                                    <div class="flex items-center gap-3">
                                        <input type="color" id="cfg-gradientFrom" value="${config.heroGradientFrom}" class="w-12 h-10 rounded-xl border border-slate-300 p-1 cursor-pointer">
                                        <span class="text-xs font-mono text-slate-600 uppercase" id="cfg-gradientFrom-val">${config.heroGradientFrom}</span>
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-2">Degradado del banner (hasta)</label>
                                    <div class="flex items-center gap-3">
                                        <input type="color" id="cfg-gradientTo" value="${config.heroGradientTo}" class="w-12 h-10 rounded-xl border border-slate-300 p-1 cursor-pointer">
                                        <span class="text-xs font-mono text-slate-600 uppercase" id="cfg-gradientTo-val">${config.heroGradientTo}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- SECCIÓN 2: BANNER HERO Y TEXTOS -->
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <div class="flex items-center justify-between">
                                <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                    <i class="fa-solid fa-heading text-brand-600"></i> Banner principal e imágenes
                                </h3>
                                <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                                    <input type="checkbox" id="cfg-showHero" ${config.showHero ? 'checked' : ''} class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500">
                                    Mostrar banner principal
                                </label>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Etiqueta destacada</label>
                                    <input type="text" id="cfg-heroBadge" value="${config.heroBadge}" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Título Principal Banner</label>
                                    <input type="text" id="cfg-heroTitle" value="${config.heroTitle}" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                                <div class="md:col-span-2">
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Subtítulo o Leyenda del Banner</label>
                                    <textarea id="cfg-heroSubtitle" rows="2" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">${config.heroSubtitle}</textarea>
                                </div>
                                <div class="md:col-span-2">
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Imagen Lateral del Banner (URL o Archivo Local)</label>
                                    <input type="url" id="cfg-heroImage" value="${config.heroImage}" placeholder="https://..." class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none mb-2">
                                    <div class="flex items-center gap-3">
                                        <label class="cursor-pointer px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition border border-slate-300 flex items-center gap-2">
                                            <i class="fa-solid fa-upload"></i> Subir imagen local de Banner
                                            <input type="file" accept="image/*" class="hidden" onchange="handleHeroImageUpload(event)">
                                        </label>
                                        <span id="hero-upload-status" class="text-xs text-emerald-600 font-medium"></span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- SECCIÓN 3: TEXTOS DEL CATÁLOGO DE PRODUCTOS -->
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                <i class="fa-solid fa-store text-brand-600"></i> Textos de la Sección de Catálogo
                            </h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Título del Catálogo</label>
                                    <input type="text" id="cfg-catalogTitle" value="${config.catalogTitle}" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Subtítulo del Catálogo</label>
                                    <input type="text" id="cfg-catalogSubtitle" value="${config.catalogSubtitle}" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Texto Placeholder de Búsqueda</label>
                                    <input type="text" id="cfg-searchPlaceholder" value="${config.searchPlaceholder}" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                            </div>
                        </div>

                        <!-- SECCIÓN 4: ESTRUCTURA Y COMPONENTES GLOBALES -->
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
                                <i class="fa-solid fa-layer-group text-brand-600"></i> Estructura y disposición de la página
                            </h3>
                            
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Columnas de Productos en Pantalla Grande</label>
                                    <select id="cfg-gridCols" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
                                        <option value="2" ${config.gridCols == 2 ? 'selected' : ''}>2 Columnas</option>
                                        <option value="3" ${config.gridCols == 3 ? 'selected' : ''}>3 Columnas</option>
                                        <option value="4" ${config.gridCols == 4 ? 'selected' : ''}>4 Columnas (Por Defecto)</option>
                                    </select>
                                </div>

                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Asistente Virtual IA Gemini (Flotante)</label>
                                    <select id="cfg-showAi" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
                                        <option value="true" ${config.showAiAssistant ? 'selected' : ''}>Habilitado / Visible</option>
                                        <option value="false" ${!config.showAiAssistant ? 'selected' : ''}>Deshabilitado / Oculto</option>
                                    </select>
                                </div>

                                <div class="sm:col-span-2">
                                    <label class="block text-xs font-semibold text-slate-700 mb-2">Orden General de las Secciones en la Página Principal</label>
                                    <select id="cfg-layoutOrder" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
                                        <option value="hero,search,grid" ${config.layoutOrder.join(',') === 'hero,search,grid' ? 'selected' : ''}>1. Banner principal, 2. Buscador, 3. Productos</option>
                                        <option value="search,hero,grid" ${config.layoutOrder.join(',') === 'search,hero,grid' ? 'selected' : ''}>1. Buscador, 2. Banner principal, 3. Productos</option>
                                        <option value="search,grid,hero" ${config.layoutOrder.join(',') === 'search,grid,hero' ? 'selected' : ''}>1. Buscador, 2. Productos, 3. Banner principal al final</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                    </form>
                </div>
            `;
        }

        function handleHeroImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('cfg-heroImage').value = e.target.result;
                document.getElementById('hero-upload-status').textContent = '¡Imagen de banner cargada!';
                showToast('Imagen del banner cargada con éxito');
            };
            reader.readAsDataURL(file);
        }

        function handleSaveConfig() {
            const siteName = document.getElementById('cfg-siteName').value.trim();
            if (!siteName) {
                showToast('Ingresa un nombre para la tienda.', 'error');
                return;
            }

            const whatsappContacts = Array.from(document.querySelectorAll('#cfg-whatsapp-list [data-contact-row="whatsapp"]'))
                .map(row => ({
                    label: row.querySelector('[data-contact-label]').value.trim(),
                    number: row.querySelector('[data-contact-number]').value.trim(),
                    enabled: row.querySelector('[data-contact-enabled]').checked
                }))
                .filter(contact => contact.number);
            if (whatsappContacts.some(contact => {
                const digits = contact.number.replace(/\D/g, '');
                return digits.length < 7 || digits.length > 15;
            })) {
                showToast('Revisa los números de WhatsApp: usa de 7 a 15 dígitos, con código de país.', 'error');
                return;
            }

            const socialLinks = Array.from(document.querySelectorAll('#cfg-social-list [data-contact-row="social"]'))
                .map(row => ({
                    name: row.querySelector('[data-contact-name]').value.trim(),
                    url: row.querySelector('[data-contact-url]').value.trim(),
                    enabled: row.querySelector('[data-contact-enabled]').checked
                }))
                .filter(link => link.name || link.url);
            if (socialLinks.some(link => !link.name || !getSafeExternalUrl(link.url))) {
                showToast('Completa el nombre y un enlace válido (http o https) para cada red social.', 'error');
                return;
            }

            const updatedConfig = {
                siteName,
                branchAddress: document.getElementById('cfg-branchAddress').value.trim(),
                googleClientId: document.getElementById('cfg-googleClientId').value.trim(),
                whatsappContacts,
                socialLinks,
                brandColor: document.getElementById('cfg-brandColor').value,
                heroGradientFrom: document.getElementById('cfg-gradientFrom').value,
                heroGradientTo: document.getElementById('cfg-gradientTo').value,
                heroBadge: document.getElementById('cfg-heroBadge').value,
                heroTitle: document.getElementById('cfg-heroTitle').value,
                heroSubtitle: document.getElementById('cfg-heroSubtitle').value,
                heroImage: document.getElementById('cfg-heroImage').value,
                showHero: document.getElementById('cfg-showHero').checked,
                catalogTitle: document.getElementById('cfg-catalogTitle').value,
                catalogSubtitle: document.getElementById('cfg-catalogSubtitle').value,
                searchPlaceholder: document.getElementById('cfg-searchPlaceholder').value,
                gridCols: parseInt(document.getElementById('cfg-gridCols').value, 10),
                showAiAssistant: document.getElementById('cfg-showAi').value === 'true',
                layoutOrder: document.getElementById('cfg-layoutOrder').value.split(',')
            };

            saveSiteConfig(updatedConfig);
        }

        document.addEventListener('input', (e) => {
            if (e.target.id === 'cfg-brandColor') document.getElementById('cfg-brandColor-val').textContent = e.target.value;
            if (e.target.id === 'cfg-gradientFrom') document.getElementById('cfg-gradientFrom-val').textContent = e.target.value;
            if (e.target.id === 'cfg-gradientTo') document.getElementById('cfg-gradientTo-val').textContent = e.target.value;
        });

        function renderProductModal() {
            return `
                <div id="product-modal" class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 hidden">
                    <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 sm:p-8 border border-slate-200 fade-in max-h-[90vh] overflow-y-auto">
                        <div class="flex items-center justify-between mb-6">
                            <h3 id="product-modal-title" class="text-xl font-bold text-slate-900">Agregar Nuevo Producto</h3>
                            <button onclick="closeProductModal()" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form id="product-form" class="space-y-4">
                            <input type="hidden" id="prod-id">
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Nombre del Producto</label>
                                <input type="text" id="prod-name" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-slate-700 mb-1">Precio de venta ($)</label>
                                    <input type="number" min="0" step="1" id="prod-price" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-slate-700 mb-1">Costo de compra ($)</label>
                                    <input type="number" min="0" step="1" id="prod-cost" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-slate-700 mb-1">Existencias iniciales</label>
                                    <input type="number" min="0" step="1" id="prod-stock" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                                </div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Categoría</label>
                                <input type="text" id="prod-category" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Imagen (URL o Archivo Local)</label>
                                <input type="text" id="prod-image" placeholder="https://..." required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none mb-2">
                                <div class="flex items-center gap-3">
                                    <label class="cursor-pointer px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition border border-slate-300 flex items-center gap-2">
                                        <i class="fa-solid fa-upload"></i> Subir imagen local
                                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(event)">
                                    </label>
                                    <span id="upload-status" class="text-xs text-emerald-600 font-medium"></span>
                                </div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
                                <textarea id="prod-desc" rows="3" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none"></textarea>
                            </div>
                            <div class="flex justify-end gap-3 pt-4">
                                <button type="button" onclick="closeProductModal()" class="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition">Cancelar</button>
                                <button type="submit" class="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-sm shadow-md transition">Guardar Producto</button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
        }

        function openProductModal(product = null) {
            const modal = document.getElementById('product-modal');
            const title = document.getElementById('product-modal-title');
            if (modal) modal.classList.remove('hidden');

            if (product) {
                if (title) title.textContent = 'Editar Producto';
                document.getElementById('prod-id').value = product.id;
                document.getElementById('prod-name').value = product.name;
                document.getElementById('prod-price').value = product.price;
                document.getElementById('prod-cost').value = Number.isInteger(product.cost) ? product.cost : '';
                document.getElementById('prod-stock').value = product.stock;
                document.getElementById('prod-category').value = product.category;
                document.getElementById('prod-image').value = product.image;
                document.getElementById('prod-desc').value = product.description;
            } else {
                if (title) title.textContent = 'Agregar Nuevo Producto';
                const form = document.getElementById('product-form');
                if (form) form.reset();
                document.getElementById('prod-id').value = '';
            }
        }

        function handleImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('prod-image').value = e.target.result;
                document.getElementById('upload-status').textContent = '¡Imagen cargada con éxito!';
                showToast('Imagen cargada correctamente');
            };
            reader.readAsDataURL(file);
        }

        function closeProductModal() {
            const modal = document.getElementById('product-modal');
            if (modal) modal.classList.add('hidden');
        }

        function editProduct(id) {
            const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
            const product = products.find(p => p.id === id);
            if (product) openProductModal(product);
        }

        function deleteProduct(id) {
            let products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));
            const product = products.find(p => p.id === id);
            if (!product) {
                showToast('No se encontró el producto que intentas eliminar.', 'error');
                return;
            }
            if (!window.confirm(`¿Eliminar "${product.name}" del catálogo?`)) return;
            products = products.filter(p => p.id !== id);
            localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
            showToast('Producto eliminado correctamente');
            renderApp();
        }

        function updateOrderStatus(orderId, newStatus) {
            const allowedStatuses = ['Pendiente', 'Preparando', 'Enviado', 'Entregado'];
            if (!allowedStatuses.includes(newStatus)) {
                showToast('El estado seleccionado no es válido.', 'error');
                return;
            }
            const orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS));
            const orderIndex = orders.findIndex(order => order.id === orderId);
            if (orderIndex < 0) {
                showToast('No se encontró el pedido que intentas actualizar.', 'error');
                return;
            }
            const order = orders[orderIndex];
            order.status = newStatus;
            if (newStatus === 'Entregado') {
                order.deliveredAt = getLocalDateTime();
                orders.splice(orderIndex, 1);
                const archivedOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS));
                if (!archivedOrders.some(archived => getArchiveIdentity(archived) === getArchiveIdentity(order))) {
                    archivedOrders.unshift(order);
                }
                localStorage.setItem(STORAGE_KEYS.ARCHIVED_ORDERS, JSON.stringify(archivedOrders));
                showToast(`El pedido ${orderId} se archivó en el historial mensual.`);
            } else {
                showToast(`Estado del pedido ${orderId} actualizado a: ${newStatus}`);
            }
            localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
            renderApp();
        }

        function deleteActiveOrder(orderId) {
            let orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS));
            const order = orders.find(item => item.id === orderId);
            if (!order) {
                showToast('No se encontró el pedido activo que intentas eliminar.', 'error');
                return;
            }
            if (!window.confirm(`¿Eliminar permanentemente el pedido ${orderId}? No aparecerá en el historial mensual ni en los cálculos.`)) return;
            orders = orders.filter(item => item.id !== orderId);
            localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
            showToast(`Pedido ${orderId} eliminado correctamente.`);
            renderApp();
        }

        function renderAdminUsers(users) {
            const activeOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS)) || [];
            const archivedOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS)) || [];
            const orders = [...activeOrders, ...archivedOrders];

            return `
                <div class="space-y-8">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h2 class="text-2xl font-bold text-slate-900">Gestión Global de Personal y Clientes</h2>
                            <p class="text-sm text-slate-500">Supervisa clientes y congela/pausa cuentas de empleados cuando lo requieras.</p>
                        </div>
                        <button onclick="openUserModal()" class="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-brand-600/30 transition flex items-center gap-2">
                            <i class="fa-solid fa-user-plus"></i> Nuevo Usuario
                        </button>
                    </div>

                    <!-- EMPLEADOS -->
                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="p-4 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <i class="fa-solid fa-user-tie text-amber-600"></i> Personal de Empleados
                            </h3>
                            <span class="text-xs text-slate-500">Gestión de Accesos y Suspensión</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr class="bg-slate-50 text-slate-400 font-semibold text-xs uppercase tracking-wider border-b border-slate-200">
                                        <th class="p-4">Empleado</th>
                                        <th class="p-4">Correo</th>
                                        <th class="p-4">Estado de Cuenta</th>
                                        <th class="p-4 text-right">Acciones / Congelar</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 text-slate-700">
                                    ${users.filter(u => u.role === 'employee').map(u => `
                                        <tr class="hover:bg-slate-50/50 transition">
                                            <td class="p-4 font-bold text-slate-900 flex items-center gap-2">
                                                <div class="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-semibold">
                                                    ${u.name.charAt(0).toUpperCase()}
                                                </div>
                                                ${u.name}
                                            </td>
                                            <td class="p-4 text-slate-600">${u.email}</td>
                                            <td class="p-4">
                                                <span class="px-3 py-1 rounded-full text-xs font-semibold ${
                                                    (u.status === 'frozen' || u.status === 'paused') 
                                                        ? 'bg-sky-100 text-sky-700 border border-sky-300' 
                                                        : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                                }">
                                                    ${(u.status === 'frozen' || u.status === 'paused') ? '<i class="fa-solid fa-snowflake mr-1"></i> Congelado' : '<i class="fa-solid fa-check mr-1"></i> Activo'}
                                                </span>
                                            </td>
                                            <td class="p-4 text-right space-x-2">
                                                <button onclick="openUserModal('${escapeHtml(u.email)}')" class="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition" title="Editar empleado">
                                                    <i class="fa-solid fa-pen-to-square"></i>
                                                </button>
                                                <button onclick="toggleUserFreeze('${u.email}')" class="px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                                                    (u.status === 'frozen' || u.status === 'paused')
                                                        ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                                        : 'bg-sky-50 text-sky-600 hover:bg-sky-100'
                                                }">
                                                    ${(u.status === 'frozen' || u.status === 'paused') ? '<i class="fa-solid fa-play"></i> Reactivar' : '<i class="fa-solid fa-snowflake"></i> Congelar'}
                                                </button>
                                                <button onclick="deleteUser('${u.email}')" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition" title="Eliminar empleado">
                                                    <i class="fa-solid fa-trash-can"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('') || `<tr><td colspan="4" class="p-4 text-center text-slate-400 text-xs">No hay empleados registrados.</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- CLIENTES -->
                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="p-4 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <i class="fa-solid fa-users text-emerald-600"></i> Registro Permanente de Clientes
                            </h3>
                            <span class="text-xs text-slate-500">Historial y Datos Registrados</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr class="bg-slate-50 text-slate-400 font-semibold text-xs uppercase tracking-wider border-b border-slate-200">
                                        <th class="p-4">Cliente</th>
                                        <th class="p-4">Correo Electrónico</th>
                                        <th class="p-4">Compras Realizadas</th>
                                        <th class="p-4">Estado</th>
                                        <th class="p-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 text-slate-700">
                                    ${users.filter(u => u.role === 'customer').map(u => {
                                        const customerOrders = orders.filter(o => o.customer === u.name);
                                        return `
                                            <tr class="hover:bg-slate-50/50 transition">
                                                <td class="p-4 font-bold text-slate-900 flex items-center gap-2">
                                                    <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold">
                                                        ${u.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p class="font-semibold text-slate-900">${u.name}</p>
                                                    </div>
                                                </td>
                                                <td class="p-4 text-slate-600">${u.email}</td>
                                                <td class="p-4 font-semibold text-slate-800">${customerOrders.length} orden(es)</td>
                                                <td class="p-4"><span class="px-3 py-1 rounded-full text-xs font-semibold ${u.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-100 text-sky-700'}">${u.status === 'active' ? 'Activo' : 'Congelado'}</span></td>
                                                <td class="p-4 text-right space-x-2">
                                                    <button onclick="openUserModal('${escapeHtml(u.email)}')" class="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition" title="Editar cliente">
                                                        <i class="fa-solid fa-pen-to-square"></i>
                                                    </button>
                                                    <button onclick="toggleUserFreeze('${u.email}')" class="p-2 rounded-xl ${u.status === 'active' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'} hover:opacity-80 transition" title="${u.status === 'active' ? 'Congelar cuenta' : 'Reactivar cuenta'}">
                                                        <i class="fa-solid ${u.status === 'active' ? 'fa-snowflake' : 'fa-play'}"></i>
                                                    </button>
                                                    <button onclick="deleteUser('${u.email}')" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition" title="Remover cliente">
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400 text-xs">No hay clientes registrados.</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- ADMINISTRADORES -->
                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="p-4 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <i class="fa-solid fa-user-shield text-brand-600"></i> Administradores
                            </h3>
                            <span class="text-xs text-slate-500">Control de cuentas con acceso global</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead>
                                    <tr class="bg-slate-50 text-slate-400 text-xs uppercase border-b border-slate-200">
                                        <th class="p-4">Administrador</th><th class="p-4">Correo</th><th class="p-4">Estado</th><th class="p-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    ${users.filter(u => u.role === 'admin').map(u => `
                                        <tr>
                                            <td class="p-4 font-semibold">${escapeHtml(u.name)}</td>
                                            <td class="p-4">${escapeHtml(u.email)}</td>
                                            <td class="p-4"><span class="px-3 py-1 rounded-full text-xs ${u.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-100 text-sky-700'}">${u.status === 'active' ? 'Activo' : 'Congelado'}</span></td>
                                            <td class="p-4 text-right space-x-2">
                                                <button onclick="openUserModal('${escapeHtml(u.email)}')" class="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100" title="Editar administrador"><i class="fa-solid fa-pen-to-square"></i></button>
                                                <button onclick="toggleUserFreeze('${u.email}')" class="p-2 rounded-xl ${u.status === 'active' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}" title="${u.status === 'active' ? 'Congelar cuenta' : 'Reactivar cuenta'}"><i class="fa-solid ${u.status === 'active' ? 'fa-snowflake' : 'fa-play'}"></i></button>
                                                <button onclick="deleteUser('${u.email}')" class="p-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100" title="Eliminar administrador"><i class="fa-solid fa-trash-can"></i></button>
                                            </td>
                                        </tr>
                                    `).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400 text-xs">No hay administradores registrados.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Modal Crear Usuario -->
                <div id="user-modal" class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 hidden">
                    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 border border-slate-200 fade-in">
                        <div class="flex items-center justify-between mb-6">
                            <h3 id="user-modal-title" class="text-xl font-bold text-slate-900">Agregar Nuevo Usuario</h3>
                            <button onclick="closeUserModal()" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form id="user-form" class="space-y-4" autocomplete="off">
                            <input type="hidden" id="user-original-email">
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">D.N.I.</label>
                                <input type="text" id="user-dni" required autocomplete="off" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Nombre Completo</label>
                                <input type="text" id="user-name" required autocomplete="off" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Correo Electrónico</label>
                                <input type="email" id="user-email" required autocomplete="off" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Contraseña <span id="user-pass-hint" class="text-xs text-slate-400"></span></label>
                                <input type="password" id="user-pass" autocomplete="new-password" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none" placeholder="Dejar vacía para conservar la actual">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Rol</label>
                                <select id="user-role" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
                                    <option value="customer">Cliente</option>
                                    <option value="employee">Empleado (Logística / Almacén)</option>
                                    <option value="admin">Administrador General</option>
                                </select>
                            </div>
                            <div class="flex justify-end gap-3 pt-4">
                                <button type="button" onclick="closeUserModal()" class="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition">Cancelar</button>
                                <button id="user-submit" type="submit" class="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-sm shadow-md transition">Guardar Usuario</button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
        }

        function toggleUserFreeze(email) {
            let users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS));
            const user = users.find(u => u.email === email);
            if (!user) {
                showToast('No se encontró el usuario que intentas actualizar.', 'error');
                return;
            }
            const currentUser = getCurrentUser();
            if (currentUser && currentUser.email === user.email && user.status !== 'frozen' && user.status !== 'paused') {
                showToast('No puedes congelar tu propia cuenta durante la sesión.', 'error');
                return;
            }
            if (user.role === 'admin' && user.status === 'active' && users.filter(u => u.role === 'admin' && u.status === 'active').length <= 1) {
                showToast('Debe permanecer al menos un administrador activo.', 'error');
                return;
            }
            if (user.status === 'frozen' || user.status === 'paused') {
                user.status = 'active';
                showToast(`La cuenta de ${user.name} ha sido reactivada.`);
            } else {
                user.status = 'frozen';
                showToast(`La cuenta de ${user.name} ha sido congelada.`, 'error');
            }
            localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
            renderApp();
        }

        function openUserModal(email = null) {
            const modal = document.getElementById('user-modal');
            const form = document.getElementById('user-form');
            const user = email ? JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS)).find(item => item.email === email) : null;
            if (email && !user) {
                showToast('No se encontró el usuario que intentas editar.', 'error');
                return;
            }
            form.reset();
            document.getElementById('user-modal-title').textContent = user ? 'Editar Usuario' : 'Agregar Nuevo Usuario';
            document.getElementById('user-original-email').value = user ? user.email : '';
            document.getElementById('user-dni').value = user ? user.dni : '';
            document.getElementById('user-name').value = user ? user.name : '';
            document.getElementById('user-email').value = user ? user.email : '';
            document.getElementById('user-role').value = user ? user.role : 'customer';
            document.getElementById('user-pass').required = !user;
            document.getElementById('user-pass-hint').textContent = user ? '(opcional; vacía conserva la actual)' : '(obligatoria)';
            document.getElementById('user-pass').placeholder = user ? 'Dejar vacía para conservar la actual' : 'Mínimo 4 caracteres';
            document.getElementById('user-submit').textContent = user ? 'Guardar Cambios' : 'Guardar Usuario';
            if (modal) modal.classList.remove('hidden');
        }

        function closeUserModal() {
            const modal = document.getElementById('user-modal');
            if (modal) modal.classList.add('hidden');
        }

        function deleteUser(email) {
            let users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS));
            const user = users.find(u => u.email === email);
            if (!user) {
                showToast('No se encontró el usuario que intentas eliminar.', 'error');
                return;
            }
            if (getCurrentUser() && getCurrentUser().email === user.email) {
                showToast('No puedes eliminar tu propia cuenta mientras tienes la sesión iniciada.', 'error');
                return;
            }
            if (user.role === 'admin' && user.status === 'active' && users.filter(u => u.role === 'admin' && u.status === 'active').length <= 1) {
                showToast('Debe permanecer al menos un administrador activo.', 'error');
                return;
            }
            if (!window.confirm(`¿Eliminar la cuenta de ${user.name}? Esta acción no se puede deshacer.`)) return;
            users = users.filter(u => u.email !== user.email);
            localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
            showToast('Usuario eliminado correctamente');
            renderApp();
        }

        function filterAdminOrders() {
            const searchInput = document.getElementById('admin-order-search');
            const statusFilter = document.getElementById('admin-order-status-filter');
            const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
            const status = statusFilter ? statusFilter.value : '';
            const rows = Array.from(document.querySelectorAll('[data-order-row]'));
            let visibleCount = 0;
            rows.forEach(row => {
                const matchesSearch = `${row.dataset.orderId} ${row.dataset.orderCustomer}`.toLowerCase().includes(search);
                const matchesStatus = !status || row.dataset.orderStatus === status;
                row.classList.toggle('hidden', !(matchesSearch && matchesStatus));
                if (matchesSearch && matchesStatus) visibleCount++;
            });
            const emptyMessage = document.getElementById('admin-order-empty-filter');
            if (emptyMessage) emptyMessage.classList.toggle('hidden', visibleCount !== 0 || rows.length === 0);
        }

        function attachAdminEvents() {
            const form = document.getElementById('product-form');
            if (form) {
                form.onsubmit = (e) => {
                    e.preventDefault();
                    const id = document.getElementById('prod-id').value;
                    const name = document.getElementById('prod-name').value;
                    const price = Number(document.getElementById('prod-price').value);
                    const cost = Number(document.getElementById('prod-cost').value);
                    const stock = parseInt(document.getElementById('prod-stock').value);
                    const category = document.getElementById('prod-category').value;
                    const image = document.getElementById('prod-image').value;
                    const description = document.getElementById('prod-desc').value;

                    if (!Number.isInteger(price) || price < 0 || !Number.isInteger(cost) || cost < 0) {
                        showToast('El precio de venta y el costo deben ser números enteros iguales o mayores que cero.', 'error');
                        return;
                    }

                    let products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS));

                    if (id) {
                        const index = products.findIndex(p => p.id == id);
                        if (index !== -1) {
                            products[index] = { id: Number(id), name, price, cost, stock, category, image, description };
                            showToast('Producto actualizado correctamente');
                        }
                    } else {
                        const newProd = { id: Date.now(), name, price, cost, stock, category, image, description };
                        products.push(newProd);
                        showToast('Producto creado y publicado exitosamente');
                    }

                    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
                    closeProductModal();
                    renderApp();
                };
            }

            const userForm = document.getElementById('user-form');
            if (userForm) {
                userForm.onsubmit = (e) => {
                    e.preventDefault();
                    const dni = document.getElementById('user-dni').value.trim();
                    const name = document.getElementById('user-name').value.trim();
                    const email = document.getElementById('user-email').value.trim();
                    const pass = document.getElementById('user-pass').value;
                    const role = document.getElementById('user-role').value;
                    const originalEmail = document.getElementById('user-original-email').value;

                    let users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS));
                    const existingUser = originalEmail ? users.find(u => u.email === originalEmail) : null;

                    if (originalEmail && !existingUser) {
                        showToast('La cuenta que intentas editar ya no existe. Actualiza la lista e inténtalo de nuevo.', 'error');
                        return;
                    }

                    if (users.some(u => (u.email.toLowerCase() === email.toLowerCase() || u.dni === dni) && u.email !== originalEmail)) {
                        showToast('Ya existe un usuario con este D.N.I. o correo electrónico.', 'error');
                        return;
                    }

                    if (!name || !dni || !email || (!existingUser && pass.length < 4) || (pass && pass.length < 4)) {
                        showToast('Completa los datos y usa una contraseña de al menos 4 caracteres.', 'error');
                        return;
                    }

                    if (!existingUser) {
                        users.push({ dni, name, email, pass, role, status: 'active' });
                    } else {
                        const currentUser = getCurrentUser();
                        const isEditingSelf = currentUser && currentUser.email === existingUser.email;
                        if (isEditingSelf && role !== 'admin') {
                            showToast('No puedes quitarte el rol de administrador durante tu sesión.', 'error');
                            return;
                        }
                        if (existingUser.role === 'admin' && existingUser.status === 'active' && role !== 'admin' &&
                            users.filter(u => u.role === 'admin' && u.status === 'active').length <= 1) {
                            showToast('Debe permanecer al menos un administrador activo.', 'error');
                            return;
                        }
                        Object.assign(existingUser, { dni, name, email, role });
                        if (pass) existingUser.pass = pass;
                        if (isEditingSelf) localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(existingUser));
                    }

                    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
                    showToast(existingUser ? `Datos de ${name} actualizados correctamente.` : `Usuario ${name} (${role.toUpperCase()}) creado con éxito`);
                    closeUserModal();
                    renderApp();
                };
            }

            const orderSearch = document.getElementById('admin-order-search');
            const orderStatusFilter = document.getElementById('admin-order-status-filter');
            const reportMonth = document.getElementById('admin-report-month');
            if (orderSearch) orderSearch.addEventListener('input', filterAdminOrders);
            if (orderStatusFilter) orderStatusFilter.addEventListener('change', filterAdminOrders);
            if (reportMonth) reportMonth.addEventListener('change', updateMonthlyOrderReportSummary);
            document.querySelectorAll('select[data-order-status]').forEach(select => {
                select.addEventListener('change', event => updateOrderStatus(event.target.dataset.orderId, event.target.value));
            });
            document.querySelectorAll('button[data-delete-order]').forEach(button => {
                button.addEventListener('click', event => deleteActiveOrder(event.currentTarget.dataset.orderId));
            });
        }

        const googleIdentityScript = document.createElement('script');
        googleIdentityScript.src = 'https://accounts.google.com/gsi/client';
        googleIdentityScript.async = true;
        googleIdentityScript.defer = true;
        googleIdentityScript.onload = setupGoogleSignIn;
        googleIdentityScript.onerror = () => console.error('No se pudo cargar Google Identity Services.');
        document.head.appendChild(googleIdentityScript);

        window.onload = async function() {
            document.getElementById('ai-chat-form').addEventListener('submit', handleAiChatSubmit);
            const sharedStorageAvailable = await initializeSharedStorage();
            renderApp();
            if (sharedStorageAvailable) window.setInterval(refreshSharedStorage, 1500);
        };
