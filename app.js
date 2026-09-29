(() => {
  const WORDS = window.CET6_WORDS || [];
  const STORAGE_KEY = "cet6-word-desk-state-v1";
  const DAY = 24 * 60 * 60 * 1000;
  const pageSize = 20;

  const defaultState = {
    progress: {},
    daily: {},
    wrongIds: [],
    settings: { sessionSize: 20, exam: "all" },
  };

  let state = loadState();
  let activeView = "study";
  let deck = [];
  let deckIndex = 0;
  let revealed = false;
  let libraryPage = 1;
  let quiz = { items: [], index: 0, correct: 0, answered: false };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { ...defaultState, ...parsed, settings: { ...defaultState.settings, ...(parsed?.settings || {}) } };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateAllStats();
  }

  function dateKey(timestamp = Date.now()) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function examOptions() {
    return [...new Set(WORDS.map((word) => word.exam))];
  }

  function filteredWords(scope = state.settings.exam) {
    return scope === "all" ? WORDS : WORDS.filter((word) => word.exam === scope);
  }

  function progressFor(id) {
    return state.progress[id] || null;
  }

  function wordStatus(word) {
    const progress = progressFor(word.id);
    if (state.wrongIds.includes(word.id) && (!progress || progress.wrong >= progress.correct)) return "wrong";
    if (!progress) return "new";
    if (progress.level >= 3) return "mastered";
    return "learning";
  }

  function statusLabel(status) {
    return { new: "未学习", learning: "学习中", mastered: "已掌握", wrong: "错词" }[status];
  }

  function isDue(word) {
    const progress = progressFor(word.id);
    return progress && progress.due <= Date.now();
  }

  function buildDeck() {
    const size = Number(state.settings.sessionSize || 20);
    const pool = filteredWords();
    const due = shuffle(pool.filter(isDue));
    const fresh = shuffle(pool.filter((word) => !progressFor(word.id)));
    const learning = shuffle(pool.filter((word) => progressFor(word.id) && !isDue(word) && wordStatus(word) !== "mastered"));
    const mastered = shuffle(pool.filter((word) => wordStatus(word) === "mastered"));
    const seen = new Set();
    deck = [...due, ...fresh, ...learning, ...mastered].filter((word) => {
      if (seen.has(word.id)) return false;
      seen.add(word.id);
      return true;
    }).slice(0, size);
    deckIndex = 0;
    renderCard();
    updateSessionPanel();
  }

  function currentWord() {
    return deck[deckIndex] || null;
  }

  function renderCard() {
    const word = currentWord();
    revealed = false;
    $("#answer-block").hidden = true;
    $("#rating-panel").hidden = true;
    $("#reveal-answer").hidden = false;
    if (!word) {
      $("#card-source").textContent = "本轮完成";
      $("#card-position").textContent = `${deck.length} / ${deck.length}`;
      $("#card-word").textContent = "完成";
      $("#card-hint").textContent = "你已经完成本轮复习，可以重新选词或开始测验。";
      $("#reveal-answer").hidden = true;
      $("#session-bar").style.width = "100%";
      return;
    }
    $("#card-source").textContent = `${word.exam} · ${word.letter}`;
    $("#card-position").textContent = `${deckIndex + 1} / ${deck.length}`;
    $("#card-word").textContent = word.word;
    $("#card-hint").textContent = "先回想含义，再显示答案";
    $("#card-meaning").textContent = word.meaning;
    $("#card-exam").textContent = word.exam;
    $("#card-letter").textContent = `选项 ${word.letter}`;
    $("#session-bar").style.width = `${(deckIndex / deck.length) * 100}%`;
  }

  function revealCard() {
    if (!currentWord() || revealed) return;
    revealed = true;
    $("#answer-block").hidden = false;
    $("#rating-panel").hidden = false;
    $("#reveal-answer").hidden = true;
  }

  function rateCard(rating) {
    const word = currentWord();
    if (!word || !revealed) return;
    const now = Date.now();
    const old = progressFor(word.id) || { reps: 0, level: 0, correct: 0, wrong: 0, interval: 0 };
    const config = {
      again: { interval: 10 / 1440, level: Math.max(0, old.level - 1), correct: 0, wrong: 1 },
      hard: { interval: Math.max(1, old.interval || 1), level: Math.max(1, old.level), correct: 1, wrong: 0 },
      good: { interval: old.interval ? Math.max(3, Math.round(old.interval * 2.2)) : 3, level: Math.min(4, old.level + 1), correct: 1, wrong: 0 },
      easy: { interval: old.interval ? Math.max(7, Math.round(old.interval * 3)) : 7, level: Math.min(4, old.level + 2), correct: 1, wrong: 0 },
    }[rating];
    state.progress[word.id] = {
      ...old,
      reps: old.reps + 1,
      interval: config.interval,
      level: config.level,
      correct: old.correct + config.correct,
      wrong: old.wrong + config.wrong,
      due: now + config.interval * DAY,
      lastReviewed: now,
      lastRating: rating,
    };
    if (rating === "again" && !state.wrongIds.includes(word.id)) state.wrongIds.push(word.id);
    if ((rating === "good" || rating === "easy") && state.progress[word.id].correct >= 2) {
      state.wrongIds = state.wrongIds.filter((id) => id !== word.id);
    }
    const today = dateKey();
    const daily = state.daily[today] || { reviewed: [], quizCorrect: 0, quizWrong: 0 };
    if (!daily.reviewed.includes(word.id)) daily.reviewed.push(word.id);
    state.daily[today] = daily;
    saveState();
    deckIndex += 1;
    renderCard();
    updateSessionPanel();
  }

  function updateSessionPanel() {
    const remaining = deck.slice(deckIndex);
    $("#session-new").textContent = remaining.filter((word) => wordStatus(word) === "new").length;
    $("#session-due").textContent = remaining.filter(isDue).length;
    $("#session-learning").textContent = remaining.filter((word) => wordStatus(word) === "learning").length;
  }

  function speak(word) {
    if (!word || !window.speechSynthesis) return showToast("当前浏览器不支持朗读");
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.86;
    speechSynthesis.speak(utterance);
  }

  function reviewedToday() {
    return state.daily[dateKey()]?.reviewed?.length || 0;
  }

  function streak() {
    let days = 0;
    const cursor = new Date();
    while (state.daily[dateKey(cursor.getTime())]?.reviewed?.length) {
      days += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return days;
  }

  function updateAllStats() {
    const statuses = WORDS.map(wordStatus);
    const mastered = statuses.filter((status) => status === "mastered").length;
    const learning = statuses.filter((status) => status === "learning").length;
    const wrong = WORDS.filter((word) => state.wrongIds.includes(word.id)).length;
    const fresh = statuses.filter((status) => status === "new").length;
    const due = WORDS.filter((word) => !progressFor(word.id) || isDue(word)).length;
    const percent = Math.round((mastered / WORDS.length) * 100);

    $("#today-count").textContent = reviewedToday();
    $("#due-count").textContent = due;
    $("#mastered-count").textContent = mastered;
    $("#streak-count").textContent = `${streak()} 天`;
    $("#sidebar-progress").textContent = `${percent}%`;
    $("#sidebar-progress-bar").style.width = `${percent}%`;
    $("#mastery-percent").textContent = `${percent}%`;
    $("#mastery-ring").style.setProperty("--progress", `${percent * 3.6}deg`);
    $("#mastery-label").textContent = percent >= 80 ? "掌握稳固" : percent >= 40 ? "持续积累" : percent > 0 ? "正在起步" : "刚刚开始";
    $("#progress-new").textContent = fresh;
    $("#progress-learning").textContent = learning;
    $("#progress-mastered").textContent = mastered;
    $("#progress-wrong").textContent = wrong;
    renderExamProgress();
  }

  function renderExamProgress() {
    const list = examOptions().map((exam) => {
      const words = WORDS.filter((word) => word.exam === exam);
      const mastered = words.filter((word) => wordStatus(word) === "mastered").length;
      const percent = Math.round((mastered / words.length) * 100);
      return `<div class="exam-progress-row"><span>${exam}</span><div class="exam-bar"><span style="width:${percent}%"></span></div><strong>${mastered}/15</strong></div>`;
    }).join("");
    $("#exam-progress-list").innerHTML = list;
  }

  function switchView(view) {
    activeView = view;
    $$(".view").forEach((item) => item.classList.remove("active"));
    $(`#${view}-view`).classList.add("active");
    $$("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    const headings = {
      study: ["今日学习", "继续完成今天的词汇"],
      quiz: ["拼写测验", "用回忆强化拼写"],
      library: ["全部词库", "查找与管理真题词汇"],
      progress: ["学习进度", "查看掌握情况"],
    };
    $("#view-eyebrow").textContent = headings[view][0];
    $("#view-title").textContent = headings[view][1];
    $("#shuffle-deck").hidden = view !== "study";
    $("#exam-filter").closest("label").hidden = view !== "study";
    if (view === "library") renderLibrary();
    if (view === "progress") updateAllStats();
    if (view === "quiz" && !quiz.items.length) startQuiz();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fillSelects() {
    const options = [`<option value="all">全部真题</option>`, ...examOptions().map((exam) => `<option value="${exam}">${exam}</option>`)].join("");
    $("#exam-filter").innerHTML = options;
    $("#library-exam-filter").innerHTML = options;
    $("#exam-filter").value = state.settings.exam;
  }

  function startQuiz() {
    const size = Number($("#quiz-size").value);
    const scope = $("#quiz-scope").value;
    let pool = filteredWords();
    if (scope === "wrong") pool = pool.filter((word) => state.wrongIds.includes(word.id));
    if (scope === "mixed") {
      const wrong = pool.filter((word) => state.wrongIds.includes(word.id));
      const fresh = pool.filter((word) => !progressFor(word.id));
      pool = [...shuffle(wrong), ...shuffle(fresh), ...shuffle(pool)].filter((word, index, all) => all.findIndex((item) => item.id === word.id) === index);
    } else {
      pool = shuffle(pool);
    }
    if (!pool.length) {
      showToast("当前范围还没有错词，已改为全部词库");
      pool = shuffle(filteredWords());
    }
    quiz = { items: pool.slice(0, size), index: 0, correct: 0, answered: false };
    renderQuiz();
  }

  function renderQuiz() {
    const word = quiz.items[quiz.index];
    if (!word) {
      $("#quiz-progress").textContent = "测验完成";
      $("#quiz-meaning").textContent = `本轮答对 ${quiz.correct} / ${quiz.items.length}`;
      $("#quiz-source").textContent = "错词已自动加入错词本";
      $("#quiz-form").hidden = true;
      $("#quiz-feedback").hidden = true;
      $("#next-question").hidden = true;
      return;
    }
    quiz.answered = false;
    $("#quiz-form").hidden = false;
    $("#quiz-input").disabled = false;
    $("#quiz-input").value = "";
    $("#quiz-feedback").hidden = true;
    $("#quiz-feedback").classList.remove("wrong");
    $("#next-question").hidden = true;
    $("#quiz-progress").textContent = `第 ${quiz.index + 1} / ${quiz.items.length} 题`;
    $("#quiz-score").textContent = `正确 ${quiz.correct}`;
    $("#quiz-meaning").textContent = word.meaning;
    $("#quiz-source").textContent = `${word.exam} · 选项 ${word.letter}`;
    setTimeout(() => $("#quiz-input").focus(), 50);
  }

  function checkQuiz(event) {
    event.preventDefault();
    if (quiz.answered) return;
    const word = quiz.items[quiz.index];
    const answer = $("#quiz-input").value.trim().toLowerCase();
    if (!answer) return;
    const correct = answer === word.word.toLowerCase();
    quiz.answered = true;
    $("#quiz-input").disabled = true;
    const feedback = $("#quiz-feedback");
    feedback.hidden = false;
    feedback.classList.toggle("wrong", !correct);
    feedback.innerHTML = correct ? `<strong>正确</strong> ${word.word}` : `<strong>正确答案：${word.word}</strong>　你的答案：${escapeHtml(answer)}`;
    $("#next-question").hidden = false;
    const today = dateKey();
    const daily = state.daily[today] || { reviewed: [], quizCorrect: 0, quizWrong: 0 };
    if (correct) {
      quiz.correct += 1;
      daily.quizCorrect += 1;
      const progress = progressFor(word.id);
      if (progress) progress.correct = (progress.correct || 0) + 1;
    } else {
      daily.quizWrong += 1;
      if (!state.wrongIds.includes(word.id)) state.wrongIds.push(word.id);
      const progress = progressFor(word.id) || { reps: 0, level: 0, correct: 0, wrong: 0, interval: 0, due: Date.now() };
      progress.wrong += 1;
      progress.level = Math.max(0, progress.level - 1);
      progress.due = Date.now();
      state.progress[word.id] = progress;
    }
    state.daily[today] = daily;
    $("#quiz-score").textContent = `正确 ${quiz.correct}`;
    saveState();
  }

  function nextQuiz() {
    quiz.index += 1;
    renderQuiz();
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function libraryWords() {
    const query = $("#search-input").value.trim().toLowerCase();
    const exam = $("#library-exam-filter").value;
    const status = $("#status-filter").value;
    return WORDS.filter((word) => {
      const matchesQuery = !query || word.word.toLowerCase().includes(query) || word.meaning.includes(query);
      const matchesExam = exam === "all" || word.exam === exam;
      const matchesStatus = status === "all" || wordStatus(word) === status || (status === "wrong" && state.wrongIds.includes(word.id));
      return matchesQuery && matchesExam && matchesStatus;
    });
  }

  function renderLibrary() {
    const words = libraryWords();
    const totalPages = Math.max(1, Math.ceil(words.length / pageSize));
    libraryPage = Math.min(libraryPage, totalPages);
    const rows = words.slice((libraryPage - 1) * pageSize, libraryPage * pageSize).map((word) => {
      const status = wordStatus(word);
      return `<tr><td>${word.word}</td><td>${word.meaning}</td><td>${word.exam} · ${word.letter}</td><td><span class="status-pill ${status}">${statusLabel(status)}</span></td><td><button class="table-sound" data-speak="${word.word}" title="朗读" aria-label="朗读 ${word.word}">▷</button></td></tr>`;
    }).join("");
    $("#word-table-body").innerHTML = rows || `<tr><td colspan="5">没有符合条件的词汇</td></tr>`;
    $("#library-count").textContent = words.length;
    $("#page-label").textContent = `${libraryPage} / ${totalPages}`;
    $("#prev-page").disabled = libraryPage <= 1;
    $("#next-page").disabled = libraryPage >= totalPages;
    $$('[data-speak]').forEach((button) => button.addEventListener("click", () => speak(button.dataset.speak)));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function bindEvents() {
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    $("#reveal-answer").addEventListener("click", revealCard);
    $("#flashcard").addEventListener("click", (event) => { if (!event.target.closest("button")) revealCard(); });
    $("#speak-word").addEventListener("click", () => speak(currentWord()?.word));
    $$(".rating").forEach((button) => button.addEventListener("click", () => rateCard(button.dataset.rating)));
    $("#shuffle-deck").addEventListener("click", () => { buildDeck(); showToast("本轮词汇已重新洗牌"); });
    $("#new-session").addEventListener("click", buildDeck);
    $("#session-size").addEventListener("input", (event) => {
      state.settings.sessionSize = Number(event.target.value);
      $("#session-size-output").textContent = event.target.value;
      saveState();
    });
    $("#session-size").addEventListener("change", buildDeck);
    $("#exam-filter").addEventListener("change", (event) => {
      state.settings.exam = event.target.value;
      saveState();
      buildDeck();
    });
    $("#quiz-form").addEventListener("submit", checkQuiz);
    $("#next-question").addEventListener("click", nextQuiz);
    $("#restart-quiz").addEventListener("click", startQuiz);
    ["#quiz-size", "#quiz-scope"].forEach((selector) => $(selector).addEventListener("change", startQuiz));
    ["#search-input", "#library-exam-filter", "#status-filter"].forEach((selector) => $(selector).addEventListener("input", () => { libraryPage = 1; renderLibrary(); }));
    $("#prev-page").addEventListener("click", () => { libraryPage -= 1; renderLibrary(); });
    $("#next-page").addEventListener("click", () => { libraryPage += 1; renderLibrary(); });
    $("#reset-data").addEventListener("click", () => {
      if (!confirm("确定清除全部学习记录吗？词库本身不会被删除。")) return;
      state = structuredClone(defaultState);
      saveState();
      fillSelects();
      buildDeck();
      renderLibrary();
      showToast("学习记录已重置");
    });
    document.addEventListener("keydown", (event) => {
      if (activeView !== "study" || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); revealCard(); }
      if (revealed && ["Digit1", "Digit2", "Digit3", "Digit4"].includes(event.code)) {
        const ratings = { Digit1: "again", Digit2: "hard", Digit3: "good", Digit4: "easy" };
        rateCard(ratings[event.code]);
      }
    });
  }

  function init() {
    fillSelects();
    $("#session-size").value = state.settings.sessionSize;
    $("#session-size-output").textContent = state.settings.sessionSize;
    bindEvents();
    buildDeck();
    updateAllStats();
    renderLibrary();
  }

  init();
})();
