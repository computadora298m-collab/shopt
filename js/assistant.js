let assistantChatOpen = false;
let assistantRequestPending = false;
let assistantConversationOwner = '';
let assistantConversationHistory = [];
let assistantRequestSequence = 0;
let assistantAvailable = true;

const assistantIconNames = new Set([
    'fa-wand-magic-sparkles',
    'fa-robot',
    'fa-headset',
    'fa-comments',
    'fa-lightbulb',
    'fa-bag-shopping',
    'fa-star'
]);

function getAssistantIconName(config = getSiteConfig()) {
    return assistantIconNames.has(config.assistantIcon)
        ? config.assistantIcon
        : 'fa-wand-magic-sparkles';
}

function getAssistantColor(config = getSiteConfig()) {
    return /^#[0-9a-f]{6}$/i.test(config.assistantColor)
        ? config.assistantColor
        : '#4f46e5';
}

function replaceAssistantIcon(container, iconName, sizeClass = '') {
    if (!container) return;
    const icon = document.createElement('i');
    icon.className = `fa-solid ${iconName}${sizeClass ? ` ${sizeClass}` : ''}`;
    container.replaceChildren(icon);
}

function showAssistantEmptyState(messagesContainer) {
    if (!messagesContainer || messagesContainer.childElementCount > 0) return;
    const emptyState = document.createElement('p');
    emptyState.id = 'ai-chat-empty-state';
    emptyState.className = 'py-8 text-center text-xs text-slate-400';
    emptyState.textContent = 'Escribe tu pregunta para iniciar la conversación.';
    messagesContainer.appendChild(emptyState);
}

function applyAssistantAppearance(config = getSiteConfig()) {
    const color = getAssistantColor(config);
    const darkerColor = '#' + [1, 3, 5]
        .map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * 0.78).toString(16).padStart(2, '0'))
        .join('');
    const iconName = getAssistantIconName(config);

    const header = document.querySelector('.ai-chat-header');
    if (header) header.style.backgroundImage = `linear-gradient(110deg, ${color}, ${darkerColor})`;

    const toggleButton = document.getElementById('ai-chat-toggle');
    if (toggleButton) {
        toggleButton.style.backgroundImage = `linear-gradient(110deg, ${color}, ${darkerColor})`;
        const toggleIcon = toggleButton.querySelector('.assistant-toggle-icon');
        if (toggleIcon) toggleIcon.className = `assistant-toggle-icon fa-solid ${iconName} text-xl`;
    }

    const submitButton = document.getElementById('ai-chat-submit');
    if (submitButton) submitButton.style.backgroundColor = color;

    document.querySelectorAll('.assistant-brand-icon, .assistant-avatar').forEach(element => {
        element.style.backgroundColor = element.classList.contains('assistant-brand-icon')
            ? 'rgba(255, 255, 255, 0.2)'
            : color;
        replaceAssistantIcon(element, iconName, element.classList.contains('assistant-brand-icon') ? 'text-sm' : 'text-xs');
    });
}

function appendAssistantMessage(message, isUser = false) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer) return null;
    const config = getSiteConfig();
    const emptyState = document.getElementById('ai-chat-empty-state');
    if (emptyState) emptyState.remove();

    const row = document.createElement('div');
    row.className = isUser ? 'flex gap-2 justify-end' : 'flex gap-2';

    if (!isUser) {
        const avatar = document.createElement('div');
        avatar.className = 'assistant-avatar w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center flex-shrink-0 text-xs';
        avatar.style.backgroundColor = getAssistantColor(config);
        replaceAssistantIcon(avatar, getAssistantIconName(config), 'text-xs');
        row.appendChild(avatar);
    }

    const bubble = document.createElement('div');
    bubble.className = isUser
        ? 'bg-brand-600 text-white p-3 rounded-2xl shadow-sm max-w-[80%] text-xs'
        : 'bg-white p-3 rounded-2xl shadow-sm border border-slate-200 text-slate-700 text-xs';
    if (isUser) bubble.style.backgroundColor = getAssistantColor(config);
    bubble.textContent = message;
    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return row;
}

function prepareAssistantForUser(user) {
    const owner = user && user.role === 'customer'
        ? `customer:${String(user.email || '').toLowerCase()}`
        : 'guest';
    if (owner === assistantConversationOwner) return;

    assistantConversationOwner = owner;
    assistantConversationHistory = [];
    assistantRequestSequence++;
    assistantRequestPending = false;

    const input = document.getElementById('ai-chat-input');
    const submitButton = document.getElementById('ai-chat-submit');
    if (input) input.disabled = false;
    if (submitButton) submitButton.disabled = false;

    const messagesContainer = document.getElementById('ai-chat-messages');
    if (messagesContainer) {
        messagesContainer.replaceChildren();
        showAssistantEmptyState(messagesContainer);
    }
}

function setAssistantAvailability(enabled) {
    const nextAvailability = Boolean(enabled);
    if (assistantAvailable === nextAvailability) return;
    assistantAvailable = nextAvailability;

    if (!assistantAvailable) {
        assistantChatOpen = false;
        assistantConversationOwner = '';
        assistantConversationHistory = [];
        assistantRequestSequence++;
        assistantRequestPending = false;

        const chatWindow = document.getElementById('ai-chat-window');
        if (chatWindow) chatWindow.classList.add('hidden');

        const input = document.getElementById('ai-chat-input');
        const submitButton = document.getElementById('ai-chat-submit');
        if (input) input.disabled = false;
        if (submitButton) submitButton.disabled = false;

        const messagesContainer = document.getElementById('ai-chat-messages');
        if (messagesContainer) {
            messagesContainer.replaceChildren();
            showAssistantEmptyState(messagesContainer);
        }
    } else {
        showAssistantEmptyState(document.getElementById('ai-chat-messages'));
    }
}

function getAssistantOrderHistory(user) {
    if (!user || user.role !== 'customer') return [];
    const activeOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
    const archivedOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.ARCHIVED_ORDERS) || '[]');
    const orders = [...activeOrders, ...archivedOrders].filter(order =>
        order.customerEmail
            ? String(order.customerEmail).toLowerCase() === String(user.email).toLowerCase()
            : order.customer === user.name
    );

    return orders.slice(-10).map(order => ({
        id: String(order.id || '').slice(0, 100),
        date: String(order.date || '').slice(0, 40),
        status: String(order.status || '').slice(0, 40),
        items: (Array.isArray(order.items) ? order.items : []).slice(0, 20).map(item => ({
            name: String(item.name || '').slice(0, 120),
            qty: Math.max(0, Number(item.qty) || 0)
        }))
    }));
}

async function sendAssistantMessage() {
    if (!assistantAvailable || !getSiteConfig().showAiAssistant) return;
    const input = document.getElementById('ai-chat-input');
    const submitButton = document.getElementById('ai-chat-submit');
    if (!input || !submitButton) {
        console.error('No se encontró el formulario del asistente.');
        return;
    }
    const text = input.value.trim();
    if (!text || assistantRequestPending) return;

    const user = getCurrentUser();
    const owner = user && user.role === 'customer'
        ? `customer:${String(user.email || '').toLowerCase()}`
        : 'guest';
    if (owner !== assistantConversationOwner) prepareAssistantForUser(user);

    const requestSequence = ++assistantRequestSequence;
    assistantRequestPending = true;
    input.disabled = true;
    submitButton.disabled = true;
    appendAssistantMessage(text, true);
    input.value = '';
    const loadingMessage = appendAssistantMessage('Pensando respuesta...');

    try {
        const products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
        const siteConfig = getSiteConfig();
        let response;
        try {
            response = await fetch('/api/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    siteName: siteConfig.siteName,
                    customerName: user && user.role === 'customer' ? user.name : '',
                    history: assistantConversationHistory.slice(-12),
                    orders: getAssistantOrderHistory(user),
                    products: products.map(product => ({
                        name: String(product.name || '').slice(0, 120),
                        category: String(product.category || '').slice(0, 80),
                        price: product.price,
                        description: String(product.description || '').slice(0, 1000),
                        stock: product.stock
                    }))
                })
            });
        } catch (error) {
            console.error('No se pudo conectar con el servidor del asistente:', error);
            throw new Error('No se pudo conectar con el servidor del asistente. Inicia server.ps1 y abre la tienda desde su dirección local.');
        }

        let result;
        try {
            result = await response.json();
        } catch (error) {
            console.error('El servidor del asistente devolvió una respuesta no válida:', error);
            if (!response.ok) {
                throw new Error(`El servidor respondió con el error HTTP ${response.status}. Comprueba que la tienda esté abierta desde server.ps1.`);
            }
            throw new Error('El servidor del asistente devolvió una respuesta inválida. Reinicia server.ps1 e inténtalo de nuevo.');
        }
        if (!response.ok) {
            const responseError = result && typeof result.error === 'string' && result.error.trim()
                ? result.error
                : 'No se pudo contactar al servicio del asistente.';
            throw new Error(responseError);
        }
        if (!result || typeof result.text !== 'string' || !result.text.trim()) {
            throw new Error('El asistente no devolvió una respuesta. Inténtalo de nuevo.');
        }
        if (requestSequence !== assistantRequestSequence) return;

        const answer = result.text.trim();
        assistantConversationHistory.push(
            { role: 'user', text },
            { role: 'model', text: answer }
        );
        assistantConversationHistory = assistantConversationHistory.slice(-12);
        appendAssistantMessage(answer);
    } catch (error) {
        if (requestSequence === assistantRequestSequence) {
            console.error('Error al consultar el asistente virtual:', error);
            const errorMessage = error && typeof error.message === 'string' && error.message.trim()
                ? error.message
                : 'No se pudo contactar al asistente. Comprueba que el servidor esté iniciado e inténtalo de nuevo.';
            appendAssistantMessage(errorMessage);
        }
    } finally {
        if (loadingMessage) loadingMessage.remove();
        if (requestSequence === assistantRequestSequence) {
            input.disabled = false;
            submitButton.disabled = false;
            assistantRequestPending = false;
            input.focus();
        }
    }
}

window.toggleAiChat = function() {
    if (!assistantAvailable || !getSiteConfig().showAiAssistant) return;
    assistantChatOpen = !assistantChatOpen;
    const chatWindow = document.getElementById('ai-chat-window');
    if (chatWindow) chatWindow.classList.toggle('hidden', !assistantChatOpen);
};

window.handleAiChatSubmit = function(event) {
    event.preventDefault();
    sendAssistantMessage();
};

window.prepareAssistantForUser = prepareAssistantForUser;
window.applyAssistantAppearance = applyAssistantAppearance;
window.setAssistantAvailability = setAssistantAvailability;
