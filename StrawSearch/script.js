let tabs = [];
let current = 0;
let loggedInUser = "";

const accountForm = document.getElementById("accountForm");
const accountMessage = document.getElementById("accountMessage");
const logoutButton = document.getElementById("logoutButton");
const historyList = document.getElementById("historyList");

async function loadHistory() {
  const response = await fetch("/api/history");
  const data = await response.json();
  loggedInUser = data.username || "";
  accountMessage.textContent = loggedInUser
    ? `Logged in as ${loggedInUser}. History expires after 30 minutes.`
    : "No account: search history is not saved.";
  logoutButton.hidden = !loggedInUser;
  historyList.innerHTML = data.history.map((item) => `<li>${item.query}</li>`).join("");
}

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", username, password })
  });

  if (response.status === 401) {
    const register = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", username, password })
    });
    if (!register.ok) {
      const error = await register.json();
      accountMessage.textContent = error.error;
      return;
    }
  } else if (!response.ok) {
    const error = await response.json();
    accountMessage.textContent = error.error;
    return;
  }

  accountForm.reset();
  await loadHistory();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  await loadHistory();
});

window.onload = () => {
  newTab();
  document.getElementById("search").focus();
};

function newTab() {
  tabs.push({ url: "" });
  current = tabs.length - 1;
  render();
}

function render() {
  const tabsDiv = document.getElementById("tabs");
  const content = document.getElementById("content");

  tabsDiv.innerHTML = "";

  tabs.forEach((t, i) => {
    let tab = document.createElement("div");
    tab.className = "tab" + (i === current ? " active" : "");
    tab.innerText = "🍓";
    tab.onclick = () => {
      current = i;
      render();
    };
    tabsDiv.appendChild(tab);
  });

  let add = document.createElement("div");
  add.className = "tab";
  add.innerText = "＋";
  add.onclick = newTab;
  tabsDiv.appendChild(add);

  content.innerHTML = "";

  let iframe = document.createElement("iframe");
  iframe.src = tabs[current]?.url || "about:blank";
  content.appendChild(iframe);
}

function getDirectUrl(value) {
  const candidate = /^(www\.|[^\s/.]+\.[^\s]+$)/i.test(value) && !/^https?:\/\//i.test(value)
    ? `https://${value}`
    : value;

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

async function search() {
  const q = document.getElementById("search").value.trim();
  if (!q) return;

  const content = document.getElementById("content");
  const directUrl = getDirectUrl(q);
  if (directUrl) {
    const openedWindow = window.open(directUrl, "_blank", "noopener,noreferrer");

    if (!openedWindow) {
      content.innerHTML = `<div class="search-status">Popup blocked. <a href="${directUrl}" target="_blank" rel="noopener noreferrer">Open URL</a></div>`;
    }

    return;
  }

  content.innerHTML = '<div class="search-status">Searching StrawSearch...</div>';

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    await loadHistory();
    const results = data.results || [];
    content.innerHTML = "";

    if (!results.length) {
      content.innerHTML = '<div class="search-status">No results found.</div>';
      return;
    }

    const heading = document.createElement("h2");
    heading.className = "search-status";
    heading.textContent = `Results for “${q}”`;
    content.appendChild(heading);

    results.forEach((item) => {
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
      content.appendChild(card);
    });
  } catch (error) {
    content.innerHTML = '<div class="search-status">Open StrawSearch at http://localhost:3000 to use the server.</div>';
  }
}

function enter(e) {
  if (e.key === "Enter") search();
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    reload();
  }
});

function back() {
  document.querySelector("iframe")?.contentWindow.history.back();
}

function forward() {
  document.querySelector("iframe")?.contentWindow.history.forward();
}

function reload() {
  let iframe = document.querySelector("iframe");
  if (iframe) iframe.src = iframe.src;
}
