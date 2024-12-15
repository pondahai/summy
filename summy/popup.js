document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('send-button').addEventListener('click', sendMessage);
    document.getElementById('summarize-button').addEventListener('click', summarizePage);
    document.getElementById('api-url').addEventListener('input', checkInputs);
    document.getElementById('api-key').addEventListener('input', checkInputs);
    document.getElementById('api-url').addEventListener('paste', checkInputs);
    document.getElementById('api-key').addEventListener('paste', checkInputs);
    document.getElementById('model-select').addEventListener('change', saveSettings);
    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('user-input').addEventListener('keydown', handleKeyDown);

    loadSettings();
});

let chatHistory = [];
let currentAiMessage = '';

async function sendMessage() {
    const userInput = document.getElementById('user-input').value;
    if (userInput.trim() === '') return;

    chatHistory.push({ role: "user", content: userInput });
    appendMessage(userInput, 'user');

    document.getElementById('user-input').value = '';

    try {
        showLoadingIndicator();
        await fetchResponse();
    } catch (error) {
        console.error('Error fetching response:', error);
        chatHistory.push({ role: "ai", content: '發生錯誤，請重試。' });
        reRenderChatHistory();
    } finally {
        hideLoadingIndicator();
    }
}

async function summarizePage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageContent = await fetchPageContent(tab.id);

    if (pageContent.trim() === '') return;

    const summaryPrompt = `請對以下內容進行摘要：${pageContent}`;
    console.log(summaryPrompt); // Log the summary prompt to the console

    // Create a temporary entry for the summary prompt
    chatHistory.push({ role: "user", content: summaryPrompt });

    try {
        showLoadingIndicator();
        await fetchResponse();
    } catch (error) {
        console.error('Error fetching summary:', error);
        chatHistory.push({ role: "ai", content: '發生錯誤，請重試。' });
        reRenderChatHistory();
    } finally {
        hideLoadingIndicator();
    }

    // Remove the temporary entry for the summary prompt
    chatHistory.pop();
}

async function fetchPageContent(tabId) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => document.body.innerText
        }, (results) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(results[0].result);
            }
        });
    });
}

function appendMessage(message, type, stream = false) {
    const chatHistoryDiv = document.getElementById('chat-history');
    let messageElement;

    if (stream) {
        messageElement = chatHistoryDiv.querySelector(`.message.${type}-message:last-child`);
        if (!messageElement) {
            messageElement = document.createElement('div');
            messageElement.className = `message ${type}-message`;
            chatHistoryDiv.appendChild(messageElement);
        }
        // Accumulate the content and convert it to Markdown
        currentAiMessage += message;
        messageElement.innerHTML = marked.parse(currentAiMessage);
    } else {
        messageElement = document.createElement('div');
        messageElement.className = `message ${type}-message`;
        messageElement.innerHTML = marked.parse(message);
        chatHistoryDiv.appendChild(messageElement);
    }

    // Add delete button
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-button';
    deleteButton.textContent = 'X';
    deleteButton.addEventListener('click', () => deleteMessage(messageElement));
    messageElement.appendChild(deleteButton);

    chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
}

async function fetchResponse() {
    const apiUrl = document.getElementById('api-url').value + '/v1/chat/completions';
    const apiKey = document.getElementById('api-key').value;
    const model = document.getElementById('model-select').value;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: chatHistory,
            stream: true
        })
    });

    if (!response.ok) {
        throw new Error('Network response was not ok');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;

    while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunk = decoder.decode(value, { stream: !done });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.substring(6);
                if (data === '[DONE]') {
                    break;
                }
                try {
                    const json = JSON.parse(data);
                    const content = json.choices[0].delta.content || '';
                    appendMessage(content, 'ai', true);
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                }
            }
        }
    }

    chatHistory.push({ role: "assistant", content: currentAiMessage });
    currentAiMessage = ''; // Reset the current AI message accumulator

    // Save the updated chat history
    saveChatHistory();
}

function reRenderChatHistory() {
    const chatHistoryDiv = document.getElementById('chat-history');
    chatHistoryDiv.innerHTML = ''; // Clear existing content

    chatHistory.forEach((message, index) => {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}-message`;
        messageElement.innerHTML = marked.parse(message.content);
        chatHistoryDiv.appendChild(messageElement);

        // Add delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.textContent = 'X';
        deleteButton.addEventListener('click', () => deleteMessage(messageElement, index));
        messageElement.appendChild(deleteButton);
    });

    chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
}

function checkInputs() {
    const apiUrl = document.getElementById('api-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();

    if (apiUrl && apiKey) {
        fetchModels(apiUrl, apiKey);
        saveSettings(); // Save settings immediately without parameters
    } else {
        document.getElementById('model-select').innerHTML = '<option value="">請填入API網址和金鑰</option>';
        document.getElementById('model-select').disabled = true;
    }
}

async function fetchModels(apiUrl, apiKey) {
    const modelsUrl = apiUrl + '/v1/models';
    try {
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        const data = await response.json();
        populateModelSelect(data.data);
    } catch (error) {
        document.getElementById('model-select').innerHTML = '<option value="">無法載入模型</option>';
        console.error('Error fetching models:', error);
    }
}

function populateModelSelect(models) {
    const selectElement = document.getElementById('model-select');
    selectElement.innerHTML = '';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        selectElement.appendChild(option);
    });
    selectElement.disabled = false;

    // Restore the selected model from storage
    chrome.storage.local.get(['model'], (result) => {
        if (result.model) {
            selectElement.value = result.model;
        }
    });
}

async function loadSettings() {
    const settings = await chrome.storage.local.get(['apiUrl', 'apiKey', 'model', 'chatHistory']);
    if (settings.apiUrl && settings.apiKey) {
        document.getElementById('api-url').value = settings.apiUrl;
        document.getElementById('api-key').value = settings.apiKey;
        fetchModels(settings.apiUrl, settings.apiKey);
    } else {
        document.getElementById('model-select').innerHTML = '<option value="">請填入API網址和金鑰</option>';
        document.getElementById('model-select').disabled = true;
    }

    if (settings.chatHistory) {
        chatHistory = settings.chatHistory;
        reRenderChatHistory();
    }
}

function saveSettings() {
    const apiUrl = document.getElementById('api-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const model = document.getElementById('model-select').value;

    chrome.storage.local.set({ apiUrl, apiKey, model }, () => {
        console.log('Settings saved successfully');
    });
}

function saveChatHistory() {
    chrome.storage.local.set({ chatHistory }, () => {
        console.log('Chat history saved successfully');
    });
}

async function clearChatHistory() {
    chatHistory = [];
    document.getElementById('chat-history').innerHTML = '';
    await chrome.storage.local.remove('chatHistory');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('expanded');
    sidebar.classList.toggle('collapsed');
}

function handleKeyDown(event) {
    if (event.key === 'Enter') {
        if (event.ctrlKey) {
            event.preventDefault();
            sendMessage();
        } else {
            event.preventDefault();
            const textarea = event.target;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '\n' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
        }
    }
}

function deleteMessage(messageElement, index) {
    if (confirm('確定要刪除這段對話嗎？')) {
        chatHistory.splice(index, 1);
        saveChatHistory();
        reRenderChatHistory();
    }
}

function showLoadingIndicator() {
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.textContent = '處理中...';
    document.getElementById('chat-container').appendChild(loadingIndicator);
}

function hideLoadingIndicator() {
    const loadingIndicator = document.querySelector('.loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
}