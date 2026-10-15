"use strict";

const $ = (id) => document.getElementById(id);
const state = { user: null, info: null, mode: "signup", previewUrl: null, requestId: 0 };
const MIN_ANALYSIS_MS = 1100; // keep the "looking at your image" steps on screen long enough to read
const CONSIDER = "Consider discussing this result with a qualified healthcare professional";
const SIMILAR = "Because some skin conditions can look similar, a qualified healthcare professional can look at it properly and tell you for sure.";

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null && c !== false && c !== "") node.append(c);
  return node;
}

async function api(path, { body, json } = {}) {
  const opts = { method: body === undefined && json === undefined ? "GET" : "POST", headers: {}, credentials: "same-origin" };
  if (opts.method === "POST") opts.headers["X-Requested-With"] = "fetch";
  if (json !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(json); }
  if (body !== undefined) opts.body = body;
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data.error || "Something went wrong. Please try again."); e.status = res.status; throw e; }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => (p * 100).toFixed(p >= 0.995 || p < 0.001 ? 0 : 1) + "%";
const whole = (p) => (p > 0 && p < 0.1 ? (p * 100).toFixed(1) : Math.round(p * 100)) + "%";  // small rates keep a decimal
const className = (code) => state.info?.classes[code]?.name ?? code;
const lower = (code) => className(code).toLowerCase();

// ---------- progress stepper ----------
function setStep(n) {
  for (const li of document.querySelectorAll("#stepper li")) {
    const s = Number(li.dataset.step);
    li.classList.toggle("done", s < n);
    li.classList.toggle("current", s === n);
    if (s === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
}

// ---------- account ----------
function setUser(user) {
  state.user = user;
  $("auth").hidden = !!user;
  $("app").hidden = !user;
  $("who").hidden = !user;
  $("signout").hidden = !user;
  $("signin-top").hidden = !!user;
  $("delete-section").hidden = !user;
  if (user) {
    $("username").textContent = user;
    $("avatar").textContent = user[0];
  }
  clearPhoto();
}

function setMode(mode) {
  state.mode = mode;
  const signup = mode === "signup";
  $("seg-login").setAttribute("aria-selected", String(!signup));
  $("seg-signup").setAttribute("aria-selected", String(signup));
  $("confirm-field").hidden = !signup;
  $("user-hint").hidden = !signup;
  $("pass-hint").hidden = !signup;
  document.querySelector('label[for="f-user"]').textContent = signup ? "Choose a username" : "Username";
  $("f-pass").autocomplete = signup ? "new-password" : "current-password";
  $("auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("auth-error").hidden = true;
}
$("seg-login").onclick = () => setMode("login");
$("seg-signup").onclick = () => setMode("signup");
$("signin-top").onclick = () => { setMode("login"); $("check").scrollIntoView({ behavior: "smooth" }); $("f-user").focus({ preventScroll: true }); };
$("hero-cta").addEventListener("click", () => setTimeout(() => (state.user ? $("choose") : $("f-user")).focus({ preventScroll: true }), 400));

$("toggle-pw").onclick = () => {
  const show = $("f-pass").type === "password";
  for (const id of ["f-pass", "f-pass2"]) $(id).type = show ? "text" : "password";
  $("toggle-pw").textContent = show ? "Hide" : "Show";
  $("toggle-pw").setAttribute("aria-label", show ? "Hide password" : "Show password");
};

function authError(msg) { $("auth-error").textContent = msg; $("auth-error").hidden = false; }

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("f-user").value.trim(), password = $("f-pass").value;
  if (state.mode === "signup") {
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return authError("Please choose a username of 3 to 32 letters or numbers (a dot, dash or underscore is fine too).");
    if (password.length < 8) return authError("Please choose a password of at least 8 characters.");
    if (password !== $("f-pass2").value) return authError("The two passwords don't match. Please type them again.");
  } else if (!username || !password) {
    return authError("Please enter your username and password.");
  }
  const btn = $("auth-submit");
  btn.disabled = true;
  try {
    const data = await api(state.mode === "signup" ? "/api/signup" : "/api/login", { json: { username, password } });
    $("auth-form").reset();
    setUser(data.user);
    toast(state.mode === "signup" ? `Welcome, ${data.user}. You're ready to check an image.` : `Welcome back, ${data.user}.`);
    $("choose").focus();
  } catch (err) {
    authError(err.message);
  } finally {
    btn.disabled = false;
  }
});

$("signout").onclick = async () => {
  try { await api("/api/logout", { json: {} }); } catch { /* signing out locally anyway */ }
  setUser(null); setMode("login");
  toast("You're signed out.");
};

$("delete-open").onclick = () => { $("delete-error").hidden = true; $("delete-form").reset(); $("delete-dialog").showModal(); };
$("delete-cancel").onclick = () => $("delete-dialog").close();
$("delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("delete-confirm").disabled = true;
  try {
    await api("/api/delete-account", { json: { password: $("d-pass").value } });
    $("delete-dialog").close();
    setUser(null); setMode("signup");
    toast("Your account has been deleted.");
  } catch (err) {
    $("delete-error").textContent = err.message; $("delete-error").hidden = false;
  } finally {
    $("delete-confirm").disabled = false;
  }
});

// ---------- upload ----------
const zone = $("zone"), fileInput = $("file");
$("choose").onclick = () => fileInput.click();
zone.onclick = () => fileInput.click();
zone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { if (fileInput.files[0]) check(fileInput.files[0], null); fileInput.value = ""; };
zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
zone.ondragleave = () => zone.classList.remove("over");
zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer.files[0]) check(e.dataTransfer.files[0], null); };
document.addEventListener("paste", (e) => {
  if (!state.user || $("app").hidden) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) check(item.getAsFile(), null);
});
$("clear").onclick = () => { clearPhoto(); toast("Image removed."); };

function clearPhoto() {
  state.requestId++;  // ignore any result still on its way
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  $("preview").removeAttribute("src"); $("preview").hidden = true;
  $("hint").hidden = false; $("clear").hidden = true;
  $("truth").textContent = ""; $("error").hidden = true;
  $("placeholder").hidden = false; $("analysing").hidden = true; $("result").hidden = true;
  setStep(1);
}

function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }

async function showProgress(id) {
  const items = [...document.querySelectorAll(".progress-list li")];
  items.forEach((li) => li.classList.remove("active", "done"));
  for (const li of items) {
    if (id !== state.requestId) return;
    li.classList.add("active");
    await sleep(MIN_ANALYSIS_MS / items.length);
    li.classList.replace("active", "done");
  }
}

async function check(blob, truth) {
  if (!blob.type.startsWith("image/")) { showError("Please choose an image file, such as a JPG or PNG photo."); return; }
  if (blob.size > 20 * 1024 * 1024) { showError("That image is larger than 20 MB. Please choose a smaller one."); return; }
  const id = ++state.requestId;
  $("error").hidden = true;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(blob);
  $("preview").src = state.previewUrl; $("preview").hidden = false; $("hint").hidden = true; $("clear").hidden = false;
  $("truth").textContent = truth ? `Example image. The confirmed answer is: ${className(truth)}.` : "";
  $("placeholder").hidden = true; $("result").hidden = true; $("analysing").hidden = false;
  setStep(2);
  try {
    const [data] = await Promise.all([api("/api/predict", { body: blob }), showProgress(id)]);
    if (id !== state.requestId) return;
    $("analysing").hidden = true;
    if (data.results.rejected) renderRejected(); else render(data.results, truth);
    setStep(data.results.rejected ? 1 : 4);
    $("result").hidden = false;
    $("result").focus({ preventScroll: true });
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (id !== state.requestId) return;
    if (err.status === 401) { setUser(null); toast("Your session ended. Please sign in again."); return; }
    $("analysing").hidden = true; $("placeholder").hidden = false; setStep(1);
    showError(err.message);
  }
}

function anotherImageButton() {
  const b = el("button", { class: "btn ghost big", type: "button", text: "Check another image" });
  b.onclick = () => { clearPhoto(); $("upload-card").scrollIntoView({ behavior: "smooth", block: "start" }); $("choose").focus({ preventScroll: true }); };
  return el("div", { class: "result-actions" }, b);
}

function renderRejected() {
  $("result").replaceChildren(
    el("p", { class: "match-label", text: "We couldn't analyse this image" }),
    el("h3", { class: "match-name", text: "This doesn't look like a photo of skin" }),
    el("p", { class: "muted", text: "The AI learned from photos of skin, nails, hair and scalp. This image looks different, so rather than guess, we've stopped here." }),
    el("div", { class: "block" }, el("h3", { text: "For a better result" }),
      el("ul", { class: "tips" },
        el("li", { text: "Take the photo fairly close, with the affected skin in the middle and filling most of the picture." }),
        el("li", { text: "Use good, even light and keep the camera steady and in focus." }),
        el("li", { text: "If something is worrying you, a doctor can examine it properly." }))),
    anotherImageButton());
}

// ---------- result ----------

const HARM = ["harmless", "mild", "moderate", "serious"];
function harmBlock(level, reason) {
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return el("div", { class: "block" }, el("h3", { text: "How harmful is it usually?" }),
    el("div", { class: "harm" },
      el("span", { class: "harm-scale", "aria-hidden": "true" }, ...HARM.map((h, i) => el("span", { class: i <= HARM.indexOf(level) ? "on" : "" }))),
      el("span", { class: "harm-label", text: cap(level) })),
    el("div", { class: "harm-ticks", "aria-hidden": "true" }, ...HARM.map((h) => el("span", { text: h }))),
    el("p", { class: "harm-reason", text: reason }));
}

// One accuracy figure for the answer shown, measured on photos the AI never trained on:
// with Gemini, how often the combined answer was right in the same situation (both AIs pointing
// the same way or not); without Gemini, how often the model was right at this confidence level.
function estimatedAccuracy(r, g) {
  const m = state.info;
  if (g && m.gemini?.test) return g.agree ? m.gemini.test.accuracy_when_agree : m.gemini.test.accuracy_when_differ;
  const band = (m.accuracy_by_confidence || []).find((b) => r.probs[0].p >= b.from && r.probs[0].p < b.to + 1e-9);
  return band ? band.accuracy : r.probs[0].p;
}

function accuracyChip(acc, label = "Estimated accuracy") {
  const level = acc >= 0.8 ? ["High", 3] : acc >= 0.5 ? ["Moderate", 2] : ["Low", 1];
  const meter = el("span", { class: "meter", "aria-hidden": "true" }, ...[1, 2, 3].map((i) => el("span", { class: i <= level[1] ? "on" : "" })));
  return el("span", { class: "chip neutral" }, meter, `${label}: ${whole(acc)}`);
}

// A condition outside the 23 groups the SkinCheck model learned: Gemini's answer is the one shown
function renderOutside(r, g, truth) {
  const concern = g.harm === "moderate" || g.harm === "serious";
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  $("result").replaceChildren(...[
    el("p", { class: "match-label", text: "Your image most closely matches" }),
    el("h3", { class: "match-name", text: cap(g.condition) }),
    el("div", { class: "chips" },
      concern ? el("span", { class: "chip info", text: "Worth discussing with a professional" }) : el("span", { class: "chip ok", text: "Appears less concerning" }),
      accuracyChip(g.confidence, "AI confidence")),
    el("p", { class: "muted", text: "This doesn't belong to the 23 groups our SkinCheck AI was trained on, so this answer comes from Google's Gemini AI." }),
    truth ? el("p", { class: "truth", text: `The confirmed answer for this example is ${className(truth)}.` }) : null,
    el("div", { class: "block" }, el("h3", { text: "What this means" }), el("p", { text: g.description })),
    harmBlock(g.harm, g.harm_reason),
    el("div", { class: "next " + (concern ? "info" : "ok") },
      el("h3", { text: concern ? CONSIDER : "This result appears less concerning, but changes in your skin should still be monitored" }),
      concern ? el("p", { text: SIMILAR }) : null,
      el("p", {}, el("b", { text: "What you can do now" })),
      el("ol", { class: "steps" },
        el("li", { text: "Take a clear photo now, so you can notice any changes." }),
        el("li", { text: "Keep the area clean and avoid picking or scratching it." }),
        el("li", { text: concern ? "Show it to a doctor or pharmacist, who can examine it properly." : "If it doesn't improve in a few weeks, or it worries you, a doctor or pharmacist can help." }))),
    el("div", { class: "block" }, el("h3", { text: "When to talk to a doctor" }),
      el("p", { text: "Whatever the result, it's worth talking to a doctor if a skin problem:" }),
      el("ul", { class: "signs" }, ...state.info.urgent_signs.map((s) => el("li", { text: s.replace(/^It /, "") })))),
    el("p", { class: "disclaimer" }, el("b", { text: "This is an AI-based prediction, not a medical diagnosis. " }),
      "An AI prediction is only one piece of information. You're always welcome to ask a doctor about any skin concern."),
    anotherImageButton(),
  ].filter(Boolean));
}

function render(r, truth) {
  if (r.gemini?.outside_groups) return renderOutside(r, r.gemini, truth);
  const m = state.info, g = r.gemini && !r.gemini.error ? r.gemini : null;
  const acc = estimatedAccuracy(r, g);
  if (g) { r = { ...r, top: g.combined_top, probs: g.combined }; }  // one combined answer
  const info = m.classes[r.top], care = info.care, second = r.probs[1];
  const healthy = r.top === "healthy";
  // Harmfulness: the more serious of the group's usual level and the AI's view of this photo
  const gHarm = g && g.group === r.top ? g.harm : null;
  const harm = gHarm && HARM.indexOf(gHarm) > HARM.indexOf(care.harm) ? [gHarm, g.harm_reason] : [care.harm, care.harm_reason];
  let concern = care.level !== "selfcare" || harm[0] === "serious", why = "", steps = care.steps, treatment = care.treatment;
  if (r.melanoma_warning && r.top !== "melanoma") {
    const pMel = r.probs.find((p) => p.code === "melanoma").p;
    concern = true;
    why = `It most closely matches ${lower(r.top)}, but it also shares some features with melanoma (${whole(pMel)} match).`;
    steps = m.classes.melanoma.care.steps;
    treatment = m.classes.melanoma.care.treatment;
  } else if (!concern && acc < 0.5) {
    concern = true;
    why = `The AI isn't confident about this image. It could also be ${lower(second.code)} (${whole(second.p)} match).`;
  }

  const chip = concern ? el("span", { class: "chip info", text: "Worth discussing with a professional" })
    : healthy ? el("span", { class: "chip ok", text: "No skin condition found" })
    : el("span", { class: "chip ok", text: "Appears less concerning" });

  const next = el("div", { class: "next " + (concern ? "info" : "ok") },
    el("h3", { text: concern ? CONSIDER : care.headline }),
    concern ? el("p", { text: [why, SIMILAR].filter(Boolean).join(" ") }) : null,
    el("p", {}, el("b", { text: "What you can do now" })),
    el("ol", { class: "steps" }, ...steps.map((s) => el("li", { text: s }))));

  const bars = r.probs.slice(0, 5).map((p) => {
    const fill = el("span", { class: "fill" + (p.code === r.top ? " lead" : "") });
    fill.style.width = (p.p * 100).toFixed(1) + "%";
    return el("div", { class: "bar" }, el("span", { class: "lab", text: className(p.code) }),
      el("span", { class: "track" }, fill), el("span", { class: "val", text: pct(p.p) }));
  });

  $("result").replaceChildren(...[
    el("p", { class: "match-label", text: "Your image most closely matches" }),
    el("h3", { class: "match-name", text: info.name }),
    g && g.group === r.top ? el("p", { class: "muted", text: `Most likely: ${g.condition}` }) : null,
    el("div", { class: "chips" }, chip, accuracyChip(acc)),
    truth ? el("p", { class: "truth", text: truth === r.top ? "This matches the confirmed answer for this example." : `The confirmed answer for this example is ${className(truth)}.` }) : null,
    r.gemini?.error ? el("p", { class: "gemini-note", text: `The Gemini check couldn't run this time (${r.gemini.error}) This result is from the SkinCheck model alone.` }) : null,

    el("div", { class: "block" }, el("h3", { text: "What this means" }),
      el("p", { text: info.about }),
      g && g.group === r.top ? el("p", {}, el("b", { text: "In your photo: " }), g.description) : null,
      info.examples ? el("p", { class: "muted", text: `This group includes: ${info.examples}.` }) : null,
      healthy ? null : el("p", { text: `It typically looks like ${care.looks}. These are general signs, not something the AI measured.` })),

    harmBlock(harm[0], harm[1]),

    next,

    healthy ? null : el("div", { class: "block" }, el("h3", { text: "How it's usually managed" }), el("p", { text: treatment })),

    el("div", { class: "block" }, el("h3", { text: "When to talk to a doctor" }),
      el("p", { text: "Whatever the result, it's worth talking to a doctor if a skin problem:" }),
      el("ul", { class: "signs" }, ...m.urgent_signs.map((s) => el("li", { text: s.replace(/^It /, "") })))),

    el("details", { class: "fold" }, el("summary", { text: "See where the AI looked" }),
      el("div", { class: "seen" },
        el("img", { src: r.attention, alt: "Your image, with the areas the AI paid less attention to dimmed" }),
        el("div", {},
          el("p", { text: "The brighter area is the part of your image that most influenced the result. The rest is dimmed." }),
          el("p", { text: "If the bright area isn't on the affected skin, the result is less reliable." })))),

    el("details", { class: "fold" }, el("summary", { text: "See the top 5 possibilities" }),
      el("div", { class: "bars" }, ...bars)),

    el("p", { class: "disclaimer" }, el("b", { text: "This is an AI-based prediction, not a medical diagnosis. " }),
      "An AI prediction is only one piece of information. You're always welcome to ask a doctor about any skin concern."),
    anotherImageButton(),
  ].filter(Boolean));
}

// ---------- reliability ----------
function renderAccuracy(m) {
  const stat = (big, small) => el("div", { class: "stat" }, el("b", { text: big }), el("span", { text: small }));
  const pc = m.photo_check;
  $("acc-stats").replaceChildren(
    stat(whole(m.test.accuracy), "of test photos were matched to the confirmed group"),
    stat(whole(m.test.top3_accuracy), "had the confirmed group among the AI's top 3 answers"),
    stat(whole(m.test.melanoma_recall_with_warning), "of melanomas were flagged as worth discussing with a professional"),
    stat(whole(pc.rejected_non_skin), "of non-skin images were recognised and not analysed"));
  $("warn-stats").replaceChildren(
    stat(whole(m.test.melanoma_recall_top_answer), "named as the closest match"),
    stat(whole(m.test.melanoma_recall_with_warning), "flagged, including shared features"),
    stat(whole(m.test.warning_on_non_melanoma), "of other images also flagged, to be safe"));
  $("warn-text").textContent = `Melanoma can look like other skin conditions. So as well as the closest match, the AI flags any image that shares even a few features with melanoma ` +
    `(${pct(m.melanoma_threshold)} or more) as worth discussing with a professional. It's better to be careful.`;
  $("check-stats").replaceChildren(
    stat(whole(pc.rejected_non_skin), `of ${pc.non_skin_images} non-skin images set aside`),
    stat(whole(pc.rejected_test_photos), "of real skin photos set aside by mistake"));

  const head = el("tr", {}, el("th", { text: "Group" }), el("th", { text: "Matched correctly" }));
  const rows = Object.keys(m.test.per_class_recall).map((c) => el("tr", {}, el("td", { text: className(c) }),
    el("td", { text: whole(m.test.per_class_recall[c]) })));
  $("recall-table").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
}

// ---------- examples (shown as names, not pictures) ----------
function renderExamples(info) {
  const src = (code) => `examples/${code}.jpg?v=${info.examples?.[code] ?? ""}`;
  for (const code of Object.keys(info.classes)) {
    const b = el("button", { type: "button", text: info.classes[code].name });
    b.onclick = async () => check(await (await fetch(src(code))).blob(), code);
    $("examples").append(b);
  }
}

// ---------- start ----------
(async () => {
  try {
    const [info, me] = await Promise.all([api("/api/info"), api("/api/me")]);
    state.info = info;
    renderAccuracy(info);
    renderExamples(info);
    for (const id of ["gemini-info", "gemini-signup-note", "gemini-step"]) $(id).hidden = !info.gemini_available;
    $("local-note").textContent = info.gemini_available ? "Your image is not saved." : "Your image is checked on this computer and is not saved.";
    setMode("signup");
    setUser(me.user);
  } catch {
    $("auth").hidden = false;
    authError("We can't reach the app right now. Please make sure run.bat (or python app/server.py) is still running.");
  }
})();
