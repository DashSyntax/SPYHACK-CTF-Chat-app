const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const chatList = document.getElementById('chat-list');
const chatTitle = document.getElementById('chat-title');
const messageThread = document.getElementById('message-thread');
const composerForm = document.getElementById('composer');
const messageInput = document.getElementById('message-input');
const userBadge = document.getElementById('user-badge');
const loginError = document.getElementById('login-error');

const state = {
  user: sessionStorage.getItem('signal-relay-user') || '',
  token: sessionStorage.getItem('signal-relay-token') || '',
  chats: [],
  activeChatId: null,
};

async function loadChats() {
  try {
    const response = await fetch('chats.json');
    if (!response.ok) {
      throw new Error('Failed to load chats.json');
    }

    const chats = await response.json();
    state.chats = Array.isArray(chats) ? chats : [];

    if (!state.activeChatId && chats.length) {
      state.activeChatId = chats[0].id;
    }

    renderChatList();
    renderChat();
  } catch (error) {
    console.error(error);
    state.chats = [];
    state.activeChatId = null;
    renderChatList();
    renderChat();
  }
}

function applyLoginView() {
  if (state.user && state.token) {
    loginScreen.classList.remove('active');
    appScreen.classList.remove('hidden');
    userBadge.textContent = state.user;
  } else {
    loginScreen.classList.add('active');
    appScreen.classList.add('hidden');
  }
}

function renderChatList() {
  chatList.innerHTML = '';

  state.chats.forEach((chat) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`;
    button.innerHTML = `
      <strong>${chat.title}</strong>
      <small>${chat.participants.join(', ')}</small>
    `;

    button.addEventListener('click', () => {
      state.activeChatId = chat.id;
      renderChatList();
      renderChat();
    });

    chatList.appendChild(button);
  });
}

function renderChat() {
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId);
  messageThread.innerHTML = '';
  if (!activeChat) {
    chatTitle.textContent = 'Select a chat';
    return;
  }

  chatTitle.textContent = activeChat.title;

  activeChat.messages.forEach((message) => {
    const box = document.createElement('article');
    const isSelf = message.sender === state.user || message.sender === 'You';
    box.className = `message ${isSelf ? 'self' : ''}`;

    const timestamp = new Date(message.time).toLocaleString([], {
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const meta = document.createElement('div');
    meta.className = 'meta';
    const sender = document.createElement('span');
    sender.textContent = message.sender;
    const time = document.createElement('span');
    time.textContent = timestamp;
    meta.append(sender, time);

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = message.text;

    box.append(meta, text);

    messageThread.appendChild(box);
  });

  messageThread.scrollTop = messageThread.scrollHeight;
}

function addMessageToCurrentChat(text) {
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId);
  if (!activeChat) {
    return;
  }

  activeChat.messages.push({
    sender: state.user,
    time: new Date().toISOString(),
    text,
  });

  renderChat();

  return activeChat;
}

async function requestAutoReply(text, chat) {
  const endpoint = document.documentElement.dataset.replyApi.replace(/\/+$/, '');

  try {
    const response = await fetch(`${endpoint}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ message: text, chatId: chat.id }),
    });
    if (response.status === 401) {
      state.user = '';
      state.token = '';
      sessionStorage.removeItem('signal-relay-user');
      sessionStorage.removeItem('signal-relay-token');
      applyLoginView();
      loginError.textContent = 'Your session expired. Please log in again.';
      return;
    }
    if (!response.ok) {
      throw new Error('Reply service request failed');
    }

    const result = await response.json();
    if (result.reply) {
      chat.messages.push({
        sender: result.sender,
        time: new Date().toISOString(),
        text: result.reply,
      });
      if (chat.id === state.activeChatId) {
        renderChat();
      }
    }
  } catch (error) {
    console.error(error);
    chat.messages.push({
      sender: 'System',
      time: new Date().toISOString(),
      text: 'The reply service is unavailable.',
    });
    if (chat.id === state.activeChatId) {
      renderChat();
    }
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const endpoint = document.documentElement.dataset.replyApi.replace(/\/+$/, '');
  loginError.textContent = '';

  if (!endpoint) {
    loginError.textContent = 'The login service is not configured.';
    return;
  }

  try {
    const response = await fetch(`${endpoint}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      loginError.textContent = response.status === 401
        ? 'Username or password is incorrect.'
        : 'The login service is unavailable.';
      return;
    }

    const result = await response.json();
    state.user = username;
    state.token = result.token;
    sessionStorage.setItem('signal-relay-user', state.user);
    sessionStorage.setItem('signal-relay-token', state.token);
    document.getElementById('password').value = '';
    applyLoginView();
  } catch (error) {
    console.error(error);
    loginError.textContent = 'The login service is unavailable.';
  }
});

logoutBtn.addEventListener('click', () => {
  state.user = '';
  state.token = '';
  sessionStorage.removeItem('signal-relay-user');
  sessionStorage.removeItem('signal-relay-token');
  applyLoginView();
});

composerForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  const chat = addMessageToCurrentChat(text);
  if (chat) {
    requestAutoReply(text, chat);
  }
  messageInput.value = '';
  messageInput.focus();
});

applyLoginView();
loadChats();
