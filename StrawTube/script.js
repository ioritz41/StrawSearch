const videos = [
  { title: 'Una aventura de color y creatividad', creator: 'Strawberry Studio', category: 'Creatividad', duration: '12:48', views: '2,4 mil', tone: 'creative' },
  { title: 'Música para una tarde tranquila', creator: 'Berry Sounds', category: 'Música', duration: '28:05', views: '8,1 mil', tone: 'music' },
  { title: 'Construyendo mi primer mundo', creator: 'Pixel Fresa', category: 'Gaming', duration: '19:32', views: '5,7 mil', tone: 'gaming' },
  { title: 'Ideas fáciles para crear en casa', creator: 'Luna Crea', category: 'Creatividad', duration: '08:16', views: '1,8 mil', tone: 'craft' },
  { title: 'Playlist de verano rosita', creator: 'Strawberry Studio', category: 'Música', duration: '42:10', views: '12 mil', tone: 'summer' },
  { title: 'El reto de las cien fresas', creator: 'Pixel Fresa', category: 'Gaming', duration: '15:44', views: '3,2 mil', tone: 'challenge' }
];

const grid = document.getElementById('videoGrid');
const emptyMessage = document.getElementById('emptyMessage');
const count = document.getElementById('videoCount');
const searchInput = document.getElementById('searchInput');
let activeCategory = 'Todos';
let currentUser = localStorage.getItem('strawtube-user') || '';
let likedVideos = JSON.parse(localStorage.getItem('strawtube-likes') || '[]');

function renderVideos() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = videos.filter((video) => {
    const matchesCategory = activeCategory === 'Todos' || video.category === activeCategory;
    const text = `${video.title} ${video.creator} ${video.category}`.toLowerCase();
    return matchesCategory && text.includes(query);
  });
  grid.innerHTML = filtered.map((video) => `
    <article class="video-card">
      <div class="thumbnail ${video.tone}"><span class="play">▶</span><span class="duration">${video.duration}</span></div>
      <div class="card-body">
        <h3>${video.title}</h3>
        <div class="creator">${video.creator}</div>
        <div class="card-footer"><span>${video.views} visualizaciones</span><button class="like-button ${likedVideos.includes(video.title) ? 'liked' : ''}" data-title="${video.title}">${likedVideos.includes(video.title) ? '🍓 Te gusta' : '🍓 Me gusta'}</button></div>
      </div>
    </article>
  `).join('');
  count.textContent = `${filtered.length} vídeos`;
  emptyMessage.hidden = filtered.length > 0;
}

grid.addEventListener('click', (event) => {
  const button = event.target.closest('.like-button');
  if (!button) return;
  const title = button.dataset.title;
  likedVideos = likedVideos.includes(title) ? likedVideos.filter((item) => item !== title) : [...likedVideos, title];
  localStorage.setItem('strawtube-likes', JSON.stringify(likedVideos));
  renderVideos();
});

document.getElementById('searchForm').addEventListener('submit', (event) => { event.preventDefault(); renderVideos(); });
searchInput.addEventListener('input', renderVideos);
document.querySelectorAll('.category').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.category.active').classList.remove('active');
  button.classList.add('active');
  activeCategory = button.dataset.category;
  renderVideos();
}));

const modal = document.getElementById('authModal');
document.getElementById('accountButton').addEventListener('click', () => { if (currentUser) { currentUser = ''; localStorage.removeItem('strawtube-user'); document.getElementById('accountButton').textContent = 'Entrar'; } else modal.hidden = false; });
document.getElementById('closeModal').addEventListener('click', () => { modal.hidden = true; });
modal.addEventListener('click', (event) => { if (event.target === modal) modal.hidden = true; });
document.getElementById('authForm').addEventListener('submit', (event) => {
  event.preventDefault();
  currentUser = document.getElementById('usernameInput').value.trim();
  localStorage.setItem('strawtube-user', currentUser);
  document.getElementById('accountButton').textContent = currentUser;
  modal.hidden = true;
  event.target.reset();
});

if (currentUser) document.getElementById('accountButton').textContent = currentUser;
renderVideos();
