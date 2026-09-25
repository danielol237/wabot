// ARIA Media Engine — Combined Metadata, Recommendation, and Catalog Resolver
const axios = require("axios");
const animeService = require("./animeService");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// Curated fallbacks for Movies, Series, Cartoons, and Kids when TMDB key is unconfigured or offline
const CURATED_MOVIES = [
  {
    id: "inception", title: "Inception", type: "movie", year: 2010, rating: "8.8", runtime: "2h 28m",
    genres: ["Sci-Fi", "Action", "Thriller"], mood: ["Mind-bending", "Intense"], tmdbId: 27205,
    poster: "https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg",
    synopsis: "A specialist who enters people’s dreams is offered a chance to erase his past by planting an idea in the mind of a reluctant heir.",
  },
  {
    id: "interstellar", title: "Interstellar", type: "movie", year: 2014, rating: "8.7", runtime: "2h 49m",
    genres: ["Sci-Fi", "Drama", "Adventure"], mood: ["Epic", "Emotional"], tmdbId: 157336,
    poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
    synopsis: "Explorers travel beyond the known limits of space to search for a future for humanity.",
  },
  {
    id: "spider-verse", title: "Spider-Man: Across the Spider-Verse", type: "movie", year: 2023, rating: "8.6", runtime: "2h 20m",
    genres: ["Animation", "Action", "Adventure"], mood: ["Epic", "Intense"], tmdbId: 569094,
    poster: "https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg",
    synopsis: "Miles Morales crosses the Spider-Verse and meets a team charged with protecting its very existence.",
  },
  {
    id: "dune-part-two", title: "Dune: Part Two", type: "movie", year: 2024, rating: "8.6", runtime: "2h 46m",
    genres: ["Sci-Fi", "Adventure", "Drama"], mood: ["Epic", "Dark"], tmdbId: 693134,
    poster: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/1mUaReqR2JkK8ZK4yC4D7RkKQ8Y.jpg",
    synopsis: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.",
  },
  {
    id: "the-batman", title: "The Batman", type: "movie", year: 2022, rating: "7.8", runtime: "2h 56m",
    genres: ["Crime", "Mystery", "Action"], mood: ["Dark", "Intense"], tmdbId: 414906,
    poster: "https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg",
    synopsis: "Batman enters Gotham’s underworld when a string of cryptic crimes exposes a deeper conspiracy.",
  },
  {
    id: "oppenheimer", title: "Oppenheimer", type: "movie", year: 2023, rating: "8.6", runtime: "3h",
    genres: ["Drama", "History"], mood: ["Serious", "Intense"], tmdbId: 872585,
    poster: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/4bI7s8j6eR9fM3Z3yV2aQ7N8J5L.jpg",
    synopsis: "A brilliant physicist leads a team through a race to create a weapon that changes the course of history.",
  },
  {
    id: "godzilla-minus-one", title: "Godzilla Minus One", type: "movie", year: 2023, rating: "8.1", runtime: "2h 5m",
    genres: ["Action", "Drama", "Sci-Fi"], mood: ["Epic", "Intense"], tmdbId: 940551,
    poster: "https://image.tmdb.org/t/p/w500/hkxxMIGaiCTmrEArK7J56JTKUlB.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/9XlK4K8f4VY3Q8g5X2G6x5F7v4R.jpg",
    synopsis: "Postwar Japan faces a new threat as one survivor finds the courage to rebuild a life worth defending.",
  }
];

const CURATED_SERIES = [
  {
    id: "arcane", title: "Arcane", type: "series", year: 2021, rating: "9.0", seasons: 2,
    genres: ["Animation", "Sci-Fi", "Action"], mood: ["Dark", "Epic", "Emotional"],
    poster: "https://image.tmdb.org/t/p/w500/fqld2212233.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/arcane.jpg",
    synopsis: "Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies.",
  },
  {
    id: "breaking-bad", title: "Breaking Bad", type: "series", year: 2008, rating: "9.5", seasons: 5,
    genres: ["Drama", "Crime", "Thriller"], mood: ["Dark", "Intense"],
    poster: "https://image.tmdb.org/t/p/w500/ztSlA.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/bb.jpg",
    synopsis: "A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing methamphetamine to secure his family's future.",
  },
  {
    id: "stranger-things", title: "Stranger Things", type: "series", year: 2016, rating: "8.7", seasons: 4,
    genres: ["Sci-Fi", "Horror", "Drama"], mood: ["Intense", "Mind-bending"],
    poster: "https://image.tmdb.org/t/p/w500/st.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/stb.jpg",
    synopsis: "When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.",
  }
];

const CURATED_CARTOONS = [
  {
    id: "avatar-the-last-airbender", title: "Avatar: The Last Airbender", type: "cartoon", year: 2005, rating: "9.3", seasons: 3,
    genres: ["Animated Series", "Adventure", "Fantasy", "Action"], mood: ["Epic", "Wholesome", "Emotional"],
    poster: "https://image.tmdb.org/t/p/w500/avatar.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/avatarb.jpg",
    synopsis: "In a war-torn world of elemental magic, a young boy reawakens to undertake a dangerous mystic quest to fulfill his destiny as the Avatar.",
  },
  {
    id: "gravity-falls", title: "Gravity Falls", type: "cartoon", year: 2012, rating: "8.9", seasons: 2,
    genres: ["Animated Series", "Comedy", "Mystery"], mood: ["Funny", "Mind-bending", "Wholesome"],
    poster: "https://image.tmdb.org/t/p/w500/gf.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/gfb.jpg",
    synopsis: "Twin siblings Dipper and Mabel Pines are spent for the summer at their great-uncle's museum in the mysterious town of Gravity Falls.",
  },
  {
    id: "classic-tom-and-jerry", title: "Tom and Jerry Classic", type: "cartoon", year: 1940, rating: "8.8", seasons: 1,
    genres: ["Classic Cartoons", "Comedy", "Family"], mood: ["Funny", "Relaxing"],
    poster: "https://image.tmdb.org/t/p/w500/tj.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/tjb.jpg",
    synopsis: "The chaotic and timeless comedic rivalry between Tom the cat and Jerry the mouse.",
  }
];

const CURATED_KIDS = [
  {
    id: "howls-moving-castle-kids", title: "Howl’s Moving Castle", type: "kids", year: 2004, rating: "8.2", runtime: "1h 59m",
    genres: ["Kids Movies", "Animation", "Family"], mood: ["Wholesome", "Relaxing"],
    poster: "https://image.tmdb.org/t/p/w500/6pZgH10jhpToPcf0uvyTCPFhWpI.jpg",
    synopsis: "A young woman’s encounter with a mysterious wizard sends her into a moving world of magic and wonder.",
  },
  {
    id: "my-neighbor-totoro", title: "My Neighbor Totoro", type: "kids", year: 1988, rating: "8.1", runtime: "1h 26m",
    genres: ["Kids Movies", "Animation", "Family"], mood: ["Wholesome", "Relaxing"],
    poster: "https://image.tmdb.org/t/p/w500/totoro.jpg",
    synopsis: "Two young sisters move to the country to be near their ailing mother and have adventures with the wonderous forest spirits.",
  },
  {
    id: "bluey", title: "Bluey", type: "kids", year: 2018, rating: "9.4", seasons: 3,
    genres: ["Kids Shows", "Animation", "Family", "Educational"], mood: ["Wholesome", "Funny", "Relaxing"],
    poster: "https://image.tmdb.org/t/p/w500/bluey.jpg",
    synopsis: "Follow the adventures of Bluey, a six-year-old Blue Heeler pup, who loves to play and turns everyday family life into extraordinary adventures.",
  }
];

async function tmdbFetch(endpoint, params = {}) {
  if (!TMDB_API_KEY) return null;
  try {
    const res = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
      params: { api_key: TMDB_API_KEY, ...params },
      timeout: 8000,
    });
    return res.data;
  } catch (_) {
    return null;
  }
}

// Unified Media Engine Export
const mediaEngine = {
  async getTrending(type = "all") {
    if (type === "anime") return animeService.getTrending();
    if (type === "movie") {
      const data = await tmdbFetch("/trending/movie/week");
      if (data && data.results) {
        return data.results.map(m => ({
          id: String(m.id), title: m.title, type: "movie", year: m.release_date ? m.release_date.slice(0, 4) : "",
          rating: m.vote_average ? m.vote_average.toFixed(1) : "",
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : "",
          synopsis: m.overview,
        }));
      }
      return CURATED_MOVIES;
    }
    if (type === "series") return CURATED_SERIES;
    if (type === "cartoon") return CURATED_CARTOONS;
    if (type === "kids") return CURATED_KIDS;

    // "all"
    const [anime, movies] = await Promise.all([
      animeService.getTrending().catch(() => []),
      this.getTrending("movie"),
    ]);
    return [...anime.slice(0, 6).map(a => ({ ...a, type: "anime" })), ...movies.slice(0, 6)];
  },

  async getLatest(type = "all") {
    if (type === "anime") return animeService.getLatest();
    if (type === "movie") return CURATED_MOVIES;
    if (type === "series") return CURATED_SERIES;
    if (type === "cartoon") return CURATED_CARTOONS;
    if (type === "kids") return CURATED_KIDS;
    return CURATED_MOVIES;
  },

  async searchGlobal(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const [animeResults, movies, series, cartoons, kids] = await Promise.all([
      animeService.searchAnime(q).catch(() => []),
      CURATED_MOVIES,
      CURATED_SERIES,
      CURATED_CARTOONS,
      CURATED_KIDS,
    ]);

    const formattedAnime = animeResults.map(a => ({ ...a, type: "anime" }));
    const filterItem = item => `${item.title} ${item.genres ? item.genres.join(" ") : ""}`.toLowerCase().includes(q);

    return [
      ...formattedAnime,
      ...movies.filter(filterItem),
      ...series.filter(filterItem),
      ...cartoons.filter(filterItem),
      ...kids.filter(filterItem),
    ];
  },

  async getDetails(type, id) {
    if (type === "anime") {
      return animeService.getDetails({ id, provider: "anilist" });
    }
    const allItems = [...CURATED_MOVIES, ...CURATED_SERIES, ...CURATED_CARTOONS, ...CURATED_KIDS];
    const found = allItems.find(i => String(i.id) === String(id));
    if (found) return found;
    return { id, type, title: "Title Not Found", synopsis: "Metadata for this item is currently unavailable." };
  },

  async recommendAnime(filters = {}, watchHistory = []) {
    const { genres = [], mood = [], year = "", status = "", format = "", epCount = "" } = filters;
    const items = await animeService.browseAnime({ genre: genres[0] || "", year, perPage: 50 }).catch(() => []);

    return items.filter(item => {
      if (genres.length > 1) {
        const itemGenres = (item.genres || []).map(g => g.toLowerCase());
        const matchAll = genres.slice(1).every(g => itemGenres.includes(g.toLowerCase()));
        if (!matchAll) return false;
      }
      if (year && String(item.year) !== String(year)) return false;
      if (format && item.type && item.type.toLowerCase() !== format.toLowerCase()) return false;
      return true;
    }).map(item => ({
      ...item,
      recommendationReason: genres.length ? `Matches selected genres (${genres.join(", ")})` : "Popular recommendation",
    }));
  },

  async recommendMovies(filters = {}) {
    const { genres = [], mood = [] } = filters;
    return CURATED_MOVIES.filter(movie => {
      if (genres.length) {
        const hasGenre = movie.genres.some(g => genres.includes(g));
        if (!hasGenre) return false;
      }
      if (mood.length && movie.mood) {
        const hasMood = movie.mood.some(m => mood.includes(m));
        if (!hasMood) return false;
      }
      return true;
    }).map(movie => ({
      ...movie,
      recommendationReason: "Matches selected criteria",
    }));
  }
};

module.exports = mediaEngine;
