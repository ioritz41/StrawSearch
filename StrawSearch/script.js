const state = {
  tabs: [],
  current: 0
};

const elements = {
  searchInput: document.getElementById("search"),
  content: document.getElementById("content")
};

const apiCall = async (endpoint, options = {}) => {
  try {
    const response = await fetch(endpoint, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const tabs = {
  new() {
    state.tabs.push({ url: "" });
    state.current = state.tabs.length - 1;
    this.render();
  },

  select(index) {
    state.current = index;
    this.render();
  },

  render() {
    const tabsDiv = document.getElementById("tabs");
    const contentDiv = elements.content;
    
    tabsDiv.innerHTML = "";
    
    state.tabs.forEach((_, i) => {
      const tabEl = document.createElement("div");
      tabEl.className = "tab" + (i === state.current ? " active" : "");
      tabEl.textContent = "🍓";
      tabEl.onclick = () => this.select(i);
      tabsDiv.appendChild(tabEl);
    });
    
    const addBtn = document.createElement("div");
    addBtn.className = "tab";
    addBtn.textContent = "＋";
    addBtn.onclick = () => this.new();
    tabsDiv.appendChild(addBtn);
    
    contentDiv.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = state.tabs[state.current]?.url || "about:blank";
    contentDiv.appendChild(iframe);
  }
};

const searchUtils = {
  isValidUrl(value) {
    const candidate = /^(www\.|[^\s/.]+\.[^\s]+$)/i.test(value) && !/^https?:\/\//i.test(value)
      ? `https://${value}`
      : value;
    try {
      const url = new URL(candidate);
      return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
    } catch {
      return "";
    }
  },

  createResultCard(item) {
    const card = document.createElement("article");
    card.className = "result-card";
    
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    
    const url = document.createElement("div");
    url.className = "result-url";
    url.textContent = item.url;
    
    const description = document.createElement("p");
    description.textContent = item.description || "";
    
    card.append(link, url, description);
    return card;
  },

  renderResults(contentDiv, query, results) {
    contentDiv.innerHTML = "";
    
    if (!results.length) {
      contentDiv.innerHTML = '<div class="search-status">No results found.</div>';
      return;
    }
    
    const heading = document.createElement("h2");
    heading.className = "search-status";
    heading.textContent = `Results for "${query}"`;
    contentDiv.appendChild(heading);
    
    results.forEach(item => {
      contentDiv.appendChild(this.createResultCard(item));
    });
  }
};

async function search() {
  const q = elements.searchInput.value.trim();
  if (!q) return;
  
  const contentDiv = elements.content;
  const directUrl = searchUtils.isValidUrl(q);
  
  if (directUrl) {
    const openedWindow = window.open(directUrl, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
      contentDiv.innerHTML = `<div class="search-status">Popup blocked. <a href="${directUrl}" target="_blank" rel="noopener noreferrer">Open URL</a></div>`;
    }
    return;
  }
  
  contentDiv.innerHTML = '<div class="search-status">Searching StrawSearch...</div>';
  
  try {
    const result = await apiCall(`/api/search?q=${encodeURIComponent(q)}`);
    if (result.ok) {
      searchUtils.renderResults(contentDiv, q, result.data.results || []);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    contentDiv.innerHTML = '<div class="search-status">Open StrawSearch at http://localhost:3000 to use the server.</div>';
  }
}

const navigation = {
  back() {
    document.querySelector("iframe")?.contentWindow.history.back();
  },

  forward() {
    document.querySelector("iframe")?.contentWindow.history.forward();
  },

  reload() {
    const iframe = document.querySelector("iframe");
    if (iframe) iframe.src = iframe.src;
  }
};

function enter(e) {
  if (e.key === "Enter") search();
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    navigation.reload();
  }
});

window.onload = () => {
  tabs.new();
  elements.searchInput.focus();
};
