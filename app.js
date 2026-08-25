// IndexedDB Vault Storage Engine
const IDB_NAME = "HarmonyOfflineVault";
const IDB_STORE = "offline_songs";

function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveTrackOffline(track) {
  console.log(`[Storage] Caching offline: ${track.title}`);
  const [audioBlob, coverBlob] = await Promise.all([
    fetch(track.url).then(r => r.blob()),
    fetch(track.cover).then(r => r.blob())
  ]);

  const record = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    audioBlob: audioBlob,
    coverBlob: coverBlob,
    savedAt: Date.now()
  };

  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => {
      console.log(`[Storage] Stored in IndexedDB: ${track.id}`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function getOfflineTracks() {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => {
      const formatted = req.result.map(item => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        url: URL.createObjectURL(item.audioBlob),
        cover: URL.createObjectURL(item.coverBlob),
        isOfflineStored: true
      }));
      resolve(formatted);
    };
    req.onerror = () => reject(req.error);
  });
}

async function removeOfflineTrack(trackId) {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(trackId);
    tx.oncomplete = () => {
      console.log(`[Storage] Deleted from IndexedDB: ${trackId}`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function getDownloadedIdsSet() {
  const db = await initOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result));
    req.onerror = () => resolve(new Set());
  });
}

async function fetchCatalog() {
  console.log("[Data Layer] Loading tracks.json manifest...");
  try {
    const res = await fetch("./tracks.json");
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    const data = await res.json();
    console.log(`[Data Layer] Catalog ready: ${data.length} tracks.`);
    return data;
  } catch (err) {
    console.error("[Data Layer] Catalog fetch failed:", err);
    return [];
  }
}

const VOLUME_ICONS = {
  high: `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`,
  muted: `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`
};

class HarmonyEngine {
  constructor() {
    this.audio = document.getElementById("audio-core");
    this.grid = document.getElementById("grid-container");
    this.catalogCount = document.getElementById("catalog-count");
    this.searchBox = document.getElementById("search-box");

    // Navigations
    this.sidebar = document.getElementById("sidebar");
    this.sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
    this.viewToggleBtn = document.getElementById("view-toggle-btn");
    this.viewIcon = document.getElementById("view-icon");
    this.navLinks = document.querySelectorAll(".nav-link");
    this.mobileNavBtns = document.querySelectorAll(".mobile-nav-btn");
    this.brandZone = document.querySelector(".navbar-brand-zone");

    // Dock Controller
    this.dockMetaClick = document.getElementById("dock-meta-click");
    this.dockCover = document.getElementById("dock-cover");
    this.dockTitle = document.getElementById("dock-title");
    this.dockArtist = document.getElementById("dock-artist");
    this.playBtn = document.getElementById("btn-play");
    this.playSvg = document.getElementById("play-svg");
    this.prevBtn = document.getElementById("btn-prev");
    this.nextBtn = document.getElementById("btn-next");
    this.shuffleBtn = document.getElementById("btn-shuffle");
    this.repeatBtn = document.getElementById("btn-repeat");
    this.repeatBadge = document.getElementById("repeat-badge");
    this.railFill = document.getElementById("rail-fill");
    this.miniRailFill = document.getElementById("mini-progress-fill");
    this.seekBar = document.getElementById("seek-bar");
    this.currTimeEl = document.getElementById("curr-time");
    this.durTimeEl = document.getElementById("dur-time");
    this.muteToggleBtn = document.getElementById("mute-toggle-btn");
    this.volumeIcon = document.getElementById("volume-icon");
    this.volSlider = document.getElementById("vol-slider");
    this.pcFullscreenBtn = document.getElementById("btn-pc-fullscreen");

    // Fullscreen Sheet
    this.sheet = document.getElementById("fullscreen-sheet");
    this.sheetClose = document.getElementById("sheet-close-btn");
    this.sheetCover = document.getElementById("sheet-cover");
    this.sheetTitle = document.getElementById("sheet-title");
    this.sheetArtist = document.getElementById("sheet-artist");
    this.sheetRailFill = document.getElementById("sheet-rail-fill");
    this.sheetSeekBar = document.getElementById("sheet-seek-bar");
    this.sheetCurr = document.getElementById("sheet-curr");
    this.sheetDur = document.getElementById("sheet-dur");
    this.sheetPlay = document.getElementById("sheet-play");
    this.sheetPlaySvg = document.getElementById("sheet-play-svg");
    this.sheetPrev = document.getElementById("sheet-prev");
    this.sheetNext = document.getElementById("sheet-next");
    this.sheetShuffle = document.getElementById("sheet-shuffle");
    this.sheetRepeat = document.getElementById("sheet-repeat");

    // State Variables
    this.tracks = [];
    this.activeQueue = [];
    this.filteredTracks = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isListView = false;
    this.currentViewMode = "library";
    this.activePlaylistName = null;
    this.prevVolume = 1;
    this.idleTimer = null;

    this.repeatMode = "all";
    this.isShuffle = false;

    this.downloadedTrackIds = new Set();
    this.likedTracks = new Set(JSON.parse(localStorage.getItem("harmony_favorites") || "[]"));
    this.playlists = JSON.parse(localStorage.getItem("harmony_playlists") || '{"Favorites Hits":[], "Chill Vibes":[]}');

    this.bindDOMHandlers();
    this.bindKeyboardShortcuts();
    this.bindMouseIdleDetection();
  }

  async start() {
    this.tracks = await fetchCatalog();
    this.downloadedTrackIds = await getDownloadedIdsSet();
    this.activeQueue = [...this.tracks];
    this.filteredTracks = [...this.tracks];

    if (this.tracks.length === 0) {
      this.dockTitle.textContent = "Library Empty";
      return;
    }

    this.renderView();
    this.loadTrack(0, false);
  }

  saveState() {
    localStorage.setItem("harmony_favorites", JSON.stringify([...this.likedTracks]));
    localStorage.setItem("harmony_playlists", JSON.stringify(this.playlists));
  }

  switchView(mode, playlistName = null, pushHistory = true) {
    console.log("[Navigation] Switching view to:", mode, "| Playlist:", playlistName);

    this.currentViewMode = mode;
    this.activePlaylistName = playlistName;

    // Filter tracks based on the selected mode
    if (mode === "library") {
      this.filteredTracks = [...this.tracks];
    } else if (mode === "favorites") {
      this.filteredTracks = this.tracks.filter(t => this.likedTracks.has(t.id));
    } else if (mode === "downloads") {
      this.filteredTracks = this.tracks.filter(t => this.downloadedTrackIds.has(t.id));
    } else if (mode === "single-playlist" && playlistName) {
      const pTrackIds = new Set(this.playlists[playlistName] || []);
      this.filteredTracks = this.tracks.filter(t => pTrackIds.has(t.id));
    }

    // Update browser history safely
    if (pushHistory && window.history && window.history.pushState) {
      if (mode !== "library") {
        window.history.pushState({ view: mode, playlist: playlistName }, "");
      }
    }

    // Update Sidebar & Bottom Nav Active States
    if (this.navLinks) {
      this.navLinks.forEach((link) => {
        link.classList.toggle("active", link.dataset.view === mode);
      });
    }
    if (this.mobileNavBtns) {
      this.mobileNavBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.view === mode);
      });
    }

    // Update Section Title & Count
    const titleEl = document.querySelector(".title-left h2");
    if (titleEl) {
      if (mode === "library") titleEl.textContent = "Library";
      else if (mode === "favorites") titleEl.textContent = "Favorites";
      else if (mode === "downloads") titleEl.textContent = "Downloads";
      else if (mode === "all-playlists") titleEl.textContent = "Playlists";
      else if (mode === "single-playlist") titleEl.textContent = playlistName || "Playlist";
    }

    // Re-render the correct view
    this.renderView();
  }

  renderView() {
    if (this.currentViewMode === "all-playlists") {
      this.renderPlaylistsOverview();
    } else {
      this.renderTrackCatalog();
    }
  }

  renderPlaylistsOverview() {
    this.grid.innerHTML = "";
    this.grid.classList.remove("list-mode");
    const playlistNames = Object.keys(this.playlists);
    this.catalogCount.textContent = `${playlistNames.length} playlists`;

    if (playlistNames.length === 0) {
      this.grid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">No playlists found.</div>`;
      return;
    }

    playlistNames.forEach(name => {
      const trackIds = this.playlists[name] || [];
      let coverArt = "./icons/icon-512.png";
      if (trackIds.length > 0) {
        const firstTrack = this.tracks.find(t => t.id === trackIds[0]);
        if (firstTrack) coverArt = firstTrack.cover;
      }

      const card = document.createElement("div");
      card.className = "track-card";
      card.innerHTML = `
        <div class="card-img-wrap">
          <img src="${coverArt}" alt="${name}" onerror="this.src='./icons/icon-512.png'" />
        </div>
        <div class="card-info">
          <h4>${name}</h4>
          <p>${trackIds.length} tracks</p>
        </div>
      `;
      card.addEventListener("click", () => this.switchView("single-playlist", name));
      this.grid.appendChild(card);
    });
  }

  renderTrackCatalog() {
    this.grid.innerHTML = "";
    this.catalogCount.textContent = `${this.filteredTracks.length} tracks`;

    if (this.filteredTracks.length === 0) {
      this.grid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">No songs found in this view.</div>`;
      return;
    }

    this.filteredTracks.forEach((track) => {
      const isCurrent = this.activeQueue[this.currentIndex]?.id === track.id;
      const isLiked = this.likedTracks.has(track.id);
      const isDownloaded = this.downloadedTrackIds.has(track.id);

      const dlIcon = isDownloaded
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>`;

      const card = document.createElement("div");
      card.className = `track-card ${isCurrent ? "active" : ""}`;
      card.innerHTML = `
        <div class="card-img-wrap">
          <img src="${track.cover}" alt="${track.title}" onerror="this.src='https://placehold.co/300x300/ffe5ea/ff2d55?text=Music'" />
          ${isCurrent && this.isPlaying ? `
            <div class="equalizer-badge">
              <div class="eq-bar"></div>
              <div class="eq-bar"></div>
              <div class="eq-bar"></div>
            </div>` : ""}
          ${isDownloaded ? `<span class="offline-indicator-badge" title="Available Offline">✓</span>` : ""}
        </div>
        <div class="card-info">
          <div>
            <h4>${track.title}</h4>
            <p>${track.artist}</p>
          </div>
          <div class="card-footer-row">
            <button class="card-action-btn add-p-btn" data-id="${track.id}" title="Add to Playlist">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>
            <button class="card-action-btn dl-btn ${isDownloaded ? "is-downloaded" : ""}" data-id="${track.id}" title="${isDownloaded ? "Remove Offline Copy" : "Save Offline"}">
              ${dlIcon}
            </button>
            <button class="card-action-btn heart-btn ${isLiked ? "liked" : ""}" data-id="${track.id}" title="Favorite">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="${isLiked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </button>
          </div>
        </div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".card-action-btn")) return;
        const trueIdx = this.activeQueue.findIndex(t => t.id === track.id);
        if (trueIdx !== -1) this.loadTrack(trueIdx, true);
      });

      card.querySelector(".add-p-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.openPlaylistModal(track.id);
      });

      card.querySelector(".dl-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.classList.add("dl-animating");
        try {
          if (this.downloadedTrackIds.has(track.id)) {
            await removeOfflineTrack(track.id);
            this.downloadedTrackIds.delete(track.id);
            if (this.currentViewMode === "downloads") {
              this.switchView("downloads");
              return;
            }
          } else {
            await saveTrackOffline(track);
            this.downloadedTrackIds.add(track.id);
          }
          this.renderView();
        } catch (err) {
          console.error("[Download Error]", err);
        } finally {
          btn.classList.remove("dl-animating");
        }
      });

      card.querySelector(".heart-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (this.likedTracks.has(track.id)) {
          this.likedTracks.delete(track.id);
          btn.classList.remove("liked");
          btn.querySelector("svg").setAttribute("fill", "none");
        } else {
          this.likedTracks.add(track.id);
          btn.classList.add("liked");
          btn.querySelector("svg").setAttribute("fill", "currentColor");
        }
        this.saveState();
        if (this.currentViewMode === "favorites") this.switchView("favorites");
      });

      this.grid.appendChild(card);
    });
  }

  loadTrack(index, autoPlay = true) {
    if (index < 0 || index >= this.activeQueue.length) return;
    this.currentIndex = index;
    const track = this.activeQueue[index];

    this.audio.src = track.url;
    this.dockTitle.textContent = track.title;
    this.dockArtist.textContent = track.artist;
    this.dockCover.src = track.cover;

    this.sheetTitle.textContent = track.title;
    this.sheetArtist.textContent = track.artist;
    this.sheetCover.src = track.cover;

    this.seekBar.value = 0;
    this.railFill.style.width = "0%";
    if (this.miniRailFill) this.miniRailFill.style.width = "0%";
    if (this.sheetRailFill) this.sheetRailFill.style.width = "0%";

    Array.from(this.grid.children).forEach((card, i) => {
      const isTarget = this.filteredTracks[i]?.id === track.id;
      card.classList.toggle("active", isTarget);
      const badge = card.querySelector(".equalizer-badge");
      if (isTarget && this.isPlaying) {
        if (!badge) {
          card.querySelector(".card-img-wrap").insertAdjacentHTML("beforeend", `
            <div class="equalizer-badge"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>
          `);
        }
      } else if (badge) {
        badge.remove();
      }
    });

    if (autoPlay) this.play();
  }

  play() {
    this.audio.play()
      .then(() => {
        this.isPlaying = true;
        const icon = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
        this.playSvg.innerHTML = icon;
        this.sheetPlaySvg.innerHTML = icon;
        this.renderView();
      })
      .catch(err => console.error("[Playback Error]", err));
  }

  pause() {
    this.audio.pause();
    this.isPlaying = false;
    const icon = `<path d="M8 5v14l11-7z"/>`;
    this.playSvg.innerHTML = icon;
    this.sheetPlaySvg.innerHTML = icon;
    this.renderView();
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  next() {
    if (this.isShuffle && this.activeQueue.length > 1) {
      let randIdx;
      do {
        randIdx = Math.floor(Math.random() * this.activeQueue.length);
      } while (randIdx === this.currentIndex);
      this.loadTrack(randIdx, true);
      return;
    }
    const nextIdx = (this.currentIndex + 1) % this.activeQueue.length;
    this.loadTrack(nextIdx, true);
  }

  prev() {
    const prevIdx = (this.currentIndex - 1 + this.activeQueue.length) % this.activeQueue.length;
    this.loadTrack(prevIdx, true);
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    this.shuffleBtn.classList.toggle("active-mode", this.isShuffle);
    this.sheetShuffle.classList.toggle("active-mode", this.isShuffle);
  }

  cycleRepeatMode() {
    if (this.repeatMode === "all") {
      this.repeatMode = "one";
      this.repeatBadge.textContent = "1";
      this.repeatBtn.classList.add("active-mode");
      this.sheetRepeat.classList.add("active-mode");
    } else if (this.repeatMode === "one") {
      this.repeatMode = "off";
      this.repeatBadge.textContent = "";
      this.repeatBtn.classList.remove("active-mode");
      this.sheetRepeat.classList.remove("active-mode");
    } else {
      this.repeatMode = "all";
      this.repeatBadge.textContent = "∞";
      this.repeatBtn.classList.add("active-mode");
      this.sheetRepeat.classList.add("active-mode");
    }
  }

  toggleMute() {
    if (this.audio.muted || this.audio.volume === 0) {
      this.audio.muted = false;
      this.audio.volume = this.prevVolume > 0 ? this.prevVolume : 0.8;
      this.volSlider.value = this.audio.volume;
      this.volumeIcon.innerHTML = VOLUME_ICONS.high;
    } else {
      this.prevVolume = this.audio.volume;
      this.audio.muted = true;
      this.audio.volume = 0;
      this.volSlider.value = 0;
      this.volumeIcon.innerHTML = VOLUME_ICONS.muted;
    }
  }

  formatTime(s) {
    const m = Math.floor(s / 60) || 0;
    const sec = Math.floor(s % 60) || 0;
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
  }

  bindMouseIdleDetection() {
    const resetIdleTimer = () => {
      this.sheet.classList.remove("idle-hidden");
      clearTimeout(this.idleTimer);
      if (this.sheet.classList.contains("active") && window.innerWidth > 1024) {
        this.idleTimer = setTimeout(() => {
          this.sheet.classList.add("idle-hidden");
        }, 3000);
      }
    };

    this.sheet.addEventListener("mousemove", resetIdleTimer);
    this.sheet.addEventListener("click", resetIdleTimer);
  }

  bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (document.activeElement === this.searchBox || document.activeElement?.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); this.togglePlay(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); if (this.audio.duration) this.audio.currentTime = Math.min(this.audio.duration, this.audio.currentTime + 5); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); this.audio.currentTime = Math.max(0, this.audio.currentTime - 5); }
      else if (e.code === "KeyM") { e.preventDefault(); this.toggleMute(); }
      else if (e.code === "Escape" && this.sheet.classList.contains("active")) { this.sheet.classList.remove("active"); }
    });
  }

  bindDOMHandlers() {
    this.sidebarToggleBtn.addEventListener("click", () => this.sidebar.classList.toggle("collapsed"));
    if (this.viewToggleBtn) this.viewToggleBtn.addEventListener("click", () => {
      this.isListView = !this.isListView;
      this.grid.classList.toggle("list-mode", this.isListView);
      this.viewIcon.innerHTML = this.isListView
        ? `<path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/>`
        : `<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>`;
    });

    this.mobileNavBtns.forEach(btn => {
      btn.addEventListener("click", () => this.switchView(btn.dataset.view));
    });

    this.navLinks.forEach(link => {
      link.addEventListener("click", () => {
        if (link.dataset.view) this.switchView(link.dataset.view);
      });
    });

    this.dockMetaClick.addEventListener("click", () => {
      if (window.innerWidth <= 1024) this.sheet.classList.add("active");
    });

    if (this.pcFullscreenBtn) {
      this.pcFullscreenBtn.addEventListener("click", () => {
        this.sheet.classList.add("active");
      });
    }

    this.sheetClose.addEventListener("click", () => this.sheet.classList.remove("active"));

    // Playback Controls
    this.playBtn.addEventListener("click", () => this.togglePlay());
    this.sheetPlay.addEventListener("click", () => this.togglePlay());
    this.nextBtn.addEventListener("click", () => this.next());
    this.sheetNext.addEventListener("click", () => this.next());
    this.prevBtn.addEventListener("click", () => this.prev());
    this.sheetPrev.addEventListener("click", () => this.prev());
    this.shuffleBtn.addEventListener("click", () => this.toggleShuffle());
    this.sheetShuffle.addEventListener("click", () => this.toggleShuffle());
    this.repeatBtn.addEventListener("click", () => this.cycleRepeatMode());
    this.sheetRepeat.addEventListener("click", () => this.cycleRepeatMode());
    this.muteToggleBtn.addEventListener("click", () => this.toggleMute());

    this.audio.addEventListener("loadedmetadata", () => {
      const dur = this.formatTime(this.audio.duration);
      this.durTimeEl.textContent = dur;
      this.sheetDur.textContent = dur;
    });

    this.audio.addEventListener("timeupdate", () => {
      if (!this.audio.duration) return;
      const pct = (this.audio.currentTime / this.audio.duration) * 100;
      this.seekBar.value = pct;
      this.railFill.style.width = `${pct}%`;
      if (this.miniRailFill) this.miniRailFill.style.width = `${pct}%`;
      if (this.sheetRailFill) this.sheetRailFill.style.width = `${pct}%`;
      const cur = this.formatTime(this.audio.currentTime);
      this.currTimeEl.textContent = cur;
      this.sheetCurr.textContent = cur;
    });

    this.audio.addEventListener("ended", () => {
      if (this.repeatMode === "one") { this.audio.currentTime = 0; this.play(); }
      else if (this.repeatMode === "all") { this.next(); }
      else { if (this.currentIndex < this.activeQueue.length - 1) this.next(); else this.pause(); }
    });

    const handleSeek = (val) => {
      const pct = parseFloat(val);
      this.railFill.style.width = `${pct}%`;
      if (this.miniRailFill) this.miniRailFill.style.width = `${pct}%`;
      if (this.sheetRailFill) this.sheetRailFill.style.width = `${pct}%`;
      if (this.audio.duration) this.audio.currentTime = (pct / 100) * this.audio.duration;
    };

    this.seekBar.addEventListener("input", (e) => handleSeek(e.target.value));
    this.sheetSeekBar.addEventListener("input", (e) => handleSeek(e.target.value));

    this.volSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      this.audio.volume = val;
      this.audio.muted = (val === 0);
      this.volumeIcon.innerHTML = val === 0 ? VOLUME_ICONS.muted : VOLUME_ICONS.high;
      if (val > 0) this.prevVolume = val;
    });

    this.searchBox.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      this.filteredTracks = this.activeQueue.filter(
        t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      );
      this.renderView();
    });

    // YouTube Modal Handlers
    const ytModal = document.getElementById("yt-import-modal");
    const importBtn = document.getElementById("import-yt-btn");
    const ytCloseBtn = document.getElementById("yt-modal-close-btn");
    const ytForm = document.getElementById("yt-import-form");
    const ytStatus = document.getElementById("yt-status-msg");
    const ytSubmitBtn = document.getElementById("yt-submit-btn");

    if (importBtn && ytModal) {
      importBtn.addEventListener("click", () => { ytModal.classList.add("open"); ytStatus.textContent = ""; });
      ytCloseBtn.addEventListener("click", () => ytModal.classList.remove("open"));

      ytForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = document.getElementById("yt-url-input").value.trim();
        ytSubmitBtn.disabled = true;
        ytSubmitBtn.textContent = "Extracting Audio...";
        ytStatus.textContent = "Downloading from YouTube...";

        try {
          const res = await fetch("http://127.0.0.1:5000/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || "Download failed");

          ytStatus.textContent = `✓ Added "${data.track.title}"`;
          document.getElementById("yt-url-input").value = "";
          this.tracks = await fetchCatalog();
          this.activeQueue = [...this.tracks];
          this.filteredTracks = [...this.tracks];
          this.renderView();

          setTimeout(() => {
            ytModal.classList.remove("open");
            ytSubmitBtn.disabled = false;
            ytSubmitBtn.textContent = "Download & Add";
          }, 1200);
        } catch (err) {
          ytStatus.textContent = `Error: ${err.message}`;
          ytSubmitBtn.disabled = false;
          ytSubmitBtn.textContent = "Download & Add";
        }
      });
    }
    // Inside bindDOMHandlers() in app.js
    document.querySelectorAll("[data-view]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const targetView = el.dataset.view;
        console.log("[UI] Nav clicked:", targetView);
        this.switchView(targetView, null, true);
      });
    });
    // Add inside bindDOMHandlers() in app.js
    window.addEventListener("popstate", (e) => {
      // If Fullscreen Sheet is open, back button closes it first
      if (this.sheet && this.sheet.classList.contains("active")) {
        this.sheet.classList.remove("active");
        return;
      }

      // If inside Downloads/Playlists/Favorites, navigate back to Library
      if (this.currentViewMode !== "library") {
        this.switchView("library", null, false);
        return;
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new HarmonyEngine();
  app.start();
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("[PWA] Active scope:", reg.scope))
      .catch((err) => console.error("[PWA] Failed:", err));
  });
}
// Add offline/online listeners in app.js
window.addEventListener("offline", () => {
  console.log("[Network] Internet lost. Falling back to offline vault.");
  this.switchView("downloads");
});

window.addEventListener("online", () => {
  console.log("[Network] Back online.");
});