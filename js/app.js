import { storage } from "./db.js";

const CATEGORIES = [
  { id: "logistica", name: "Logística", sections: ["NET", "SATÉLITE"] },
  { id: "equipo", name: "Equipo", sections: ["NET", "SATÉLITE"] },
  { id: "muelle", name: "Muelle", sections: ["NET", "SATÉLITE"] }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state;
let toastTimer;
let saveQueue = Promise.resolve();

const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const dateAtTime = (dateKey, time) => {
  if (!dateKey || !time) return null;
  const date = new Date(`${dateKey}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const clone = (value) => JSON.parse(JSON.stringify(value));

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatTime = (iso) =>
  iso
    ? new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(iso))
    : "--:--";

const formatDate = (key, options = {}) => {
  const { year, ...rest } = options;
  const dateOptions = {
    day: "numeric",
    month: "long",
    ...rest
  };
  if (year !== false) dateOptions.year = year || "numeric";
  return new Intl.DateTimeFormat("es-ES", dateOptions).format(parseDateKey(key));
};

const formatShortDate = (key) =>
  new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(parseDateKey(key));

const minutesBetween = (start, end) => {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
};

const formatMinutes = (minutes, compact = false) => {
  const safeMinutes = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (compact) return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  return `${hours} h ${String(remainder).padStart(2, "0")} min`;
};

const toDateTimeInput = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const toIso = (localValue) => (localValue ? new Date(localValue).toISOString() : null);

const categoryName = (id) => CATEGORIES.find((category) => category.id === id)?.name ?? id;

const sortItems = (items) =>
  [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

const itemOperations = (item) =>
  [
    item.limas ? `LIMAS ${item.limas}` : "",
    Number(item.trailers) > 0
      ? `${item.trailers} ${Number(item.trailers) === 1 ? "remolque" : "remolques"}`
      : "",
    item.machineryNote || ""
  ].filter(Boolean);

const currentDuration = () => {
  const { clockIn, clockOut } = state.currentDay;
  if (!clockIn) return 0;
  return minutesBetween(clockIn, clockOut || new Date().toISOString());
};

const recordDuration = (record) => minutesBetween(record.clockIn, record.clockOut);

const latestHistoryForDate = (dateKey) =>
  [...state.history]
    .filter((record) => record.date === dateKey)
    .sort((a, b) => new Date(b.closedAt || b.clockOut || 0) - new Date(a.closedAt || a.clockOut || 0))[0];

function setSaving(isSaving) {
  const button = $("#sync-state");
  button.classList.toggle("saving", isSaving);
  button.title = isSaving ? "Guardando…" : "Guardado localmente";
}

function persist(message) {
  setSaving(true);
  saveQueue = saveQueue
    .then(() => storage.save(state))
    .then(() => {
      setSaving(false);
      if (message) showToast(message);
    })
    .catch((error) => {
      console.error(error);
      setSaving(false);
      showToast("No se pudo guardar. Exporta una copia y vuelve a intentarlo.");
    });
  return saveQueue;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function showModal({ kicker = "", title, content, onOpen }) {
  $("#modal-kicker").textContent = kicker;
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = content;
  $("#modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => onOpen?.($("#modal-content")));
}

function closeModal() {
  $("#modal-backdrop").hidden = true;
  $("#modal-content").innerHTML = "";
  document.body.style.overflow = "";
}

function navigate(viewName) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  $$(".nav-item").forEach((item) =>
    item.classList.toggle("active", item.dataset.viewTarget === viewName)
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (viewName === "history") renderHistory();
  if (viewName === "schedule") renderSchedule();
  if (viewName === "more") renderStats();
}

function renderAll() {
  renderHeader();
  renderDashboard();
  renderWork();
  renderHistory();
  renderSchedule();
  renderStats();
  updateConnectionStatus();
}

function renderHeader() {
  $("#today-label").textContent = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());
  $("#live-clock").textContent = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function calculateStats() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const recordsThisYear = state.history.filter((record) => parseDateKey(record.date).getFullYear() === year);
  const recordsThisMonth = recordsThisYear.filter(
    (record) => parseDateKey(record.date).getMonth() === month
  );
  const yearMinutes = recordsThisYear.reduce((sum, record) => sum + recordDuration(record), 0);
  const monthMinutes = recordsThisMonth.reduce((sum, record) => sum + recordDuration(record), 0);
  const yearDays = new Set(recordsThisYear.map((record) => record.date)).size;
  const monthDays = new Set(recordsThisMonth.map((record) => record.date)).size;

  return {
    yearMinutes,
    monthMinutes,
    yearDays,
    monthDays,
    averageMinutes: yearDays ? yearMinutes / yearDays : 0
  };
}

function getNextShift() {
  const now = new Date();
  return [...state.schedule]
    .map((shift) => ({ ...shift, startsAt: dateAtTime(shift.date, shift.start) }))
    .filter((shift) => shift.startsAt && shift.startsAt >= new Date(now.getTime() - 12 * 60 * 60 * 1000))
    .sort((a, b) => a.startsAt - b.startsAt)[0];
}

function nextShiftHtml(shift) {
  if (!shift) return '<div class="empty-inline">No hay turnos programados.</div>';
  const date = parseDateKey(shift.date);
  return `
    <div class="next-shift-summary">
      <div class="date-block">
        <strong>${date.getDate()}</strong>
        <small>${new Intl.DateTimeFormat("es-ES", { month: "short" }).format(date)}</small>
      </div>
      <div>
        <p>${escapeHtml(formatShortDate(shift.date))}</p>
        <span>${escapeHtml(shift.start)} – ${escapeHtml(shift.end)} aprox.</span>
      </div>
    </div>`;
}

function buildAlerts() {
  const alerts = [];
  const todayKey = localDateKey();
  const todayShift = state.schedule.find((shift) => shift.date === todayKey);
  const current = state.currentDay;
  const closedToday = Boolean(latestHistoryForDate(todayKey));

  if (todayShift) {
    alerts.push({ text: `Hoy trabajas de ${todayShift.start} a ${todayShift.end} aprox.`, type: "blue" });
    if (!current.clockIn && !closedToday) {
      alerts.push({ text: "No has fichado la entrada.", type: "warning" });
    }
    const scheduledEnd = dateAtTime(todayKey, todayShift.end);
    if (current.clockIn && !current.clockOut && scheduledEnd && new Date() >= scheduledEnd) {
      alerts.push({ text: "No has fichado la salida.", type: "warning" });
    }
  }

  if (current.clockIn && !current.clockOut) {
    alerts.push({ text: `Turno abierto desde las ${formatTime(current.clockIn)}.`, type: "blue" });
  }

  const next = getNextShift();
  if (next?.startsAt) {
    const hours = (next.startsAt - new Date()) / 3600000;
    if (hours > 0 && hours <= 24) {
      const display = hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} h`;
      alerts.push({ text: `Te quedan ${display} para entrar.`, type: "blue" });
    }
  }
  return alerts;
}

function alertsHtml(alerts) {
  return alerts
    .map(
      (alert) =>
        `<div class="app-alert ${alert.type === "blue" ? "blue" : ""}"><span class="status-dot"></span>${escapeHtml(alert.text)}</div>`
    )
    .join("");
}

function renderDashboard() {
  const current = state.currentDay;
  const todayKey = localDateKey();
  const latestToday = latestHistoryForDate(todayKey);
  const active = Boolean(current.clockIn);
  const stats = calculateStats();
  const items = current.items || [];
  const pending = items.filter((item) => item.status === "pending").length;
  const done = items.length - pending;
  const progress = items.length ? Math.round((done / items.length) * 100) : 0;

  $("#shift-status").textContent = active ? "Turno en curso" : latestToday ? "Jornada cerrada" : "Sin fichar";
  $("#shift-status").classList.toggle("active-status", active);
  $("#clock-in-value").textContent = formatTime(active ? current.clockIn : latestToday?.clockIn);
  $("#clock-out-value").textContent = formatTime(active ? current.clockOut : latestToday?.clockOut);
  $("#worked-today-value").textContent = formatMinutes(
    active ? currentDuration() : recordDuration(latestToday || {})
  );
  $("#clock-in-button").disabled = active;
  $("#clock-out-button").disabled = !active;
  $("#edit-current-times").disabled = !active && !latestToday;
  $("#edit-current-times").style.opacity = !active && !latestToday ? "0.35" : "1";
  $("#month-hours").textContent = formatMinutes(stats.monthMinutes, true);
  $("#month-days").textContent = `${stats.monthDays} ${stats.monthDays === 1 ? "día trabajado" : "días trabajados"}`;
  $("#pending-total").textContent = pending;
  $("#done-total").textContent = `${done} ${done === 1 ? "tarea hecha" : "tareas hechas"}`;
  $("#progress-number").textContent = `${progress}%`;
  $("#progress-bar").style.width = `${progress}%`;
  $("#next-shift-home").innerHTML = nextShiftHtml(getNextShift());

  const alerts = buildAlerts();
  $("#home-alerts").innerHTML = alertsHtml(alerts);
  maybeShowNotifications(alerts);
}

function renderWork() {
  const container = $("#work-sections");
  container.innerHTML = CATEGORIES.map((category) => {
    const subsections = category.sections
      .map((section) => {
        const items = sortItems(
          state.currentDay.items.filter(
            (item) => item.category === category.id && item.section === section
          )
        );
        const pending = items.filter((item) => item.status === "pending").length;
        const done = items.length - pending;
        const list = items.length
          ? items
              .map(
                (item) => `
                  <div class="work-item ${item.status === "done" ? "done" : ""}">
                    <button class="item-main item-open-button" type="button" data-edit-item="${item.id}" aria-label="Abrir vuelo ${escapeHtml(item.flight || "sin número")}">
                      <strong>${escapeHtml(item.flight || "Sin vuelo")}</strong>
                      <span>Parking ${escapeHtml(item.parking || "—")}</span>
                      ${
                        itemOperations(item).length
                          ? `<small class="item-operations">${itemOperations(item).map(escapeHtml).join(" · ")}</small>`
                          : ""
                      }
                    </button>
                    <div class="item-actions">
                      <button class="mini-icon-button" type="button" data-edit-item="${item.id}" aria-label="Editar">
                        <svg viewBox="0 0 24 24"><path d="m4 16-1 5 5-1L19 9l-4-4Z"/><path d="m13 7 4 4"/></svg>
                      </button>
                      <button class="mini-icon-button" type="button" data-delete-item="${item.id}" aria-label="Eliminar">
                        <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>
                      </button>
                      <button class="status-button ${item.status}" type="button" data-toggle-item="${item.id}">
                        ${item.status === "done" ? "HECHO" : "PENDIENTE"}
                      </button>
                    </div>
                  </div>`
              )
              .join("")
          : '<div class="empty-list">Sin vuelos añadidos</div>';

        return `
          <section class="work-subsection">
            <div class="subsection-header">
              <div>
                <h4 class="subsection-title">${section === "SATÉLITE" ? "Satélite" : "NET"}</h4>
                <div class="subsection-counts">Pendientes: <b>${pending}</b> · Hechos: <b>${done}</b></div>
              </div>
              <button class="add-button" type="button" data-add-item="${category.id}|${section}" aria-label="Añadir vuelo">+</button>
            </div>
            <div class="item-list">${list}</div>
            ${
              pending
                ? `<button class="mark-all-button" type="button" data-mark-all="${category.id}|${section}">Marcar todo como hecho</button>`
                : ""
            }
          </section>`;
      })
      .join("");

    return `
      <article class="category-card ${category.id}">
        <div class="category-heading">
          <span class="category-mark"></span>
          <h3>${category.name}</h3>
        </div>
        ${subsections}
      </article>`;
  }).join("");
}

function renderHistory() {
  const query = ($("#history-search")?.value || "").trim().toLocaleLowerCase("es");
  const records = [...state.history]
    .filter((record) => {
      if (!query) return true;
      const haystack = [
        record.date,
        formatDate(record.date),
        ...(record.items || []).flatMap((item) => [
          item.flight,
          item.parking,
          item.limas,
          item.trailers,
          item.machineryNote
        ])
      ]
        .join(" ")
        .toLocaleLowerCase("es");
      return haystack.includes(query);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || new Date(b.closedAt || 0) - new Date(a.closedAt || 0));

  if (!records.length) {
    $("#history-list").innerHTML = `<div class="empty-list">${
      query ? "No hay resultados para esta búsqueda." : "El historial aparecerá aquí al cerrar tu primera jornada."
    }</div>`;
    return;
  }

  let currentYear = "";
  let currentMonth = "";
  const html = [];

  records.forEach((record) => {
    const date = parseDateKey(record.date);
    const year = String(date.getFullYear());
    const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (year !== currentYear) {
      html.push(`<h3 class="history-year">${year}</h3>`);
      currentYear = year;
      currentMonth = "";
    }
    if (monthKey !== currentMonth) {
      html.push(
        `<h4 class="history-month">${new Intl.DateTimeFormat("es-ES", { month: "long" }).format(date)}</h4>`
      );
      currentMonth = monthKey;
    }

    const groupedTasks = CATEGORIES.map((category) => {
      const categoryItems = (record.items || []).filter((item) => item.category === category.id);
      if (!categoryItems.length) return "";
      const tasks = categoryItems
        .map(
          (item) => `
            <div class="history-task">
              <div>
                <strong>${escapeHtml(item.flight || "Sin vuelo")}</strong>
                <span>· P${escapeHtml(item.parking || "—")} · ${escapeHtml(item.section)}</span>
                ${
                  itemOperations(item).length
                    ? `<small class="history-operation">${itemOperations(item).map(escapeHtml).join(" · ")}</small>`
                    : ""
                }
              </div>
              <b class="mini-status ${item.status}">${item.status === "done" ? "HECHO" : "PENDIENTE"}</b>
            </div>`
        )
        .join("");
      return `<h5 class="history-section-title">${category.name}</h5>${tasks}`;
    }).join("");

    html.push(`
      <details class="history-entry">
        <summary>
          <div class="date-block">
            <strong>${date.getDate()}</strong>
            <small>${new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(date)}</small>
          </div>
          <div>
            <strong>${escapeHtml(formatDate(record.date, { year: false }))}</strong>
            <span>${formatTime(record.clockIn)} – ${formatTime(record.clockOut)} · ${(record.items || []).length} vuelos</span>
          </div>
          <b class="hours-chip">${formatMinutes(recordDuration(record), true)}</b>
        </summary>
        <div class="history-detail">
          <div class="history-detail-actions">
            <button class="small-button" type="button" data-edit-history="${record.id}">Editar horas</button>
          </div>
          ${groupedTasks || '<div class="empty-list">Jornada sin vuelos registrados</div>'}
        </div>
      </details>`);
  });

  $("#history-list").innerHTML = html.join("");
}

function renderSchedule() {
  const next = getNextShift();
  $("#next-shift-detail").innerHTML = nextShiftHtml(next);

  const today = parseDateKey(localDateKey());
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 7);

  const upcoming = [...state.schedule]
    .filter((shift) => {
      const date = parseDateKey(shift.date);
      return date >= today && date < end;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  $("#schedule-list").innerHTML = upcoming.length
    ? upcoming
        .map((shift) => {
          const date = parseDateKey(shift.date);
          return `
            <article class="schedule-item ${shift.date === localDateKey() ? "today" : ""}">
              <div class="date-block">
                <strong>${date.getDate()}</strong>
                <small>${new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(date)}</small>
              </div>
              <div class="schedule-copy">
                <strong>${escapeHtml(formatShortDate(shift.date))}</strong>
                <span>${escapeHtml(shift.start)} – ${escapeHtml(shift.end)} aprox.</span>
              </div>
              <button class="mini-icon-button" type="button" data-delete-schedule="${shift.id}" aria-label="Eliminar turno">
                <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7"/></svg>
              </button>
            </article>`;
        })
        .join("")
    : '<div class="empty-list">No hay turnos durante los próximos 7 días.</div>';

  $("#schedule-alerts").innerHTML = alertsHtml(buildAlerts());
  $("#notifications-button").textContent =
    "Notification" in window && Notification.permission === "granted"
      ? "Avisos activados"
      : "Activar avisos";
}

function renderStats() {
  const stats = calculateStats();
  $("#stats-month-hours").textContent = formatMinutes(stats.monthMinutes, true);
  $("#stats-year-hours").textContent = formatMinutes(stats.yearMinutes, true);
  $("#stats-month-days").textContent = stats.monthDays;
  $("#stats-year-days").textContent = stats.yearDays;
  $("#stats-average").textContent = formatMinutes(stats.averageMinutes, true);
  $("#csv-month").value ||= localDateKey().slice(0, 7);
}

function openItemForm(category, section, item = null) {
  showModal({
    kicker: `${categoryName(category)} · ${section === "SATÉLITE" ? "Satélite" : section}`,
    title: item ? "Editar vuelo" : "Añadir vuelo",
    content: `
      <form id="item-form" class="form-grid">
        <label class="field">
          <span>Parking</span>
          <input id="item-parking" name="parking" inputmode="numeric" maxlength="12" placeholder="552" value="${escapeHtml(item?.parking || "")}" />
        </label>
        <label class="field">
          <span>Vuelo</span>
          <input id="item-flight" name="flight" autocapitalize="characters" maxlength="16" placeholder="IB6845" value="${escapeHtml(item?.flight || "")}" />
        </label>
        <label class="field">
          <span>LIMAS · cintas locales</span>
          <input id="item-limas" name="limas" autocapitalize="characters" maxlength="40" placeholder="L1, L2…" value="${escapeHtml(item?.limas || "")}" />
        </label>
        <label class="field">
          <span>Número de remolques</span>
          <input id="item-trailers" name="trailers" type="number" inputmode="numeric" min="0" max="99" placeholder="0" value="${escapeHtml(item?.trailers || "")}" />
        </label>
        <label class="field">
          <span>Maquinaria necesaria / notas</span>
          <textarea id="item-machinery-note" name="machineryNote" rows="3" maxlength="300" placeholder="Ej.: 1 tractor, plataforma, GPU…">${escapeHtml(item?.machineryNote || "")}</textarea>
        </label>
        <div class="form-actions">
          <button class="secondary-action" type="button" data-close-modal>Cancelar</button>
          <button class="primary-action clock-in" type="submit">${item ? "Guardar" : "Añadir"}</button>
        </div>
      </form>`,
    onOpen: (root) => {
      $("#item-parking", root).focus();
      $("#item-form", root).addEventListener("submit", async (event) => {
        event.preventDefault();
        const parking = $("#item-parking", root).value.trim().toUpperCase();
        const flight = $("#item-flight", root).value.trim().toUpperCase().replace(/\s+/g, "");
        const limas = $("#item-limas", root).value.trim().toUpperCase();
        const trailers = Math.max(0, Number.parseInt($("#item-trailers", root).value, 10) || 0);
        const machineryNote = $("#item-machinery-note", root).value.trim();
        if (!parking && !flight) {
          showToast("Escribe al menos un parking o un vuelo.");
          return;
        }
        if (item) {
          item.parking = parking;
          item.flight = flight;
          item.limas = limas;
          item.trailers = trailers;
          item.machineryNote = machineryNote;
          item.updatedAt = new Date().toISOString();
        } else {
          state.currentDay.items.push({
            id: uid(),
            category,
            section,
            parking,
            flight,
            limas,
            trailers,
            machineryNote,
            status: "pending",
            createdAt: new Date().toISOString()
          });
        }
        await persist(item ? "Vuelo actualizado." : "Vuelo añadido.");
        closeModal();
        renderDashboard();
        renderWork();
      });
    }
  });
}

function openTimesForm(record, isHistory = false) {
  showModal({
    kicker: isHistory ? formatDate(record.date) : "Jornada actual",
    title: "Editar horas",
    content: `
      <form id="times-form" class="form-grid">
        <label class="field">
          <span>Hora de entrada</span>
          <input id="edit-clock-in" type="datetime-local" value="${toDateTimeInput(record.clockIn)}" />
        </label>
        <label class="field">
          <span>Hora de salida</span>
          <input id="edit-clock-out" type="datetime-local" value="${toDateTimeInput(record.clockOut)}" />
        </label>
        <div class="form-actions">
          <button class="secondary-action" type="button" data-close-modal>Cancelar</button>
          <button class="primary-action clock-in" type="submit">Guardar cambios</button>
        </div>
      </form>`,
    onOpen: (root) => {
      $("#times-form", root).addEventListener("submit", (event) => {
        event.preventDefault();
        const clockIn = toIso($("#edit-clock-in", root).value);
        const clockOut = toIso($("#edit-clock-out", root).value);
        if (clockIn && clockOut && new Date(clockOut) < new Date(clockIn)) {
          showToast("La salida no puede ser anterior a la entrada.");
          return;
        }
        record.clockIn = clockIn;
        record.clockOut = clockOut;
        if (clockIn) record.date = localDateKey(new Date(clockIn));
        persist("Horas corregidas.");
        closeModal();
        renderAll();
      });
    }
  });
}

function openScheduleForm() {
  const today = localDateKey();
  showModal({
    kicker: "Mi horario",
    title: "Añadir turno",
    content: `
      <form id="schedule-form" class="form-grid">
        <label class="field">
          <span>Día</span>
          <input id="schedule-date" type="date" min="${today}" value="${today}" required />
        </label>
        <label class="field">
          <span>Hora de entrada</span>
          <input id="schedule-start" type="time" value="08:00" required />
        </label>
        <label class="field">
          <span>Hora aproximada de salida</span>
          <input id="schedule-end" type="time" value="16:00" required />
        </label>
        <div class="form-actions">
          <button class="secondary-action" type="button" data-close-modal>Cancelar</button>
          <button class="primary-action clock-in" type="submit">Guardar turno</button>
        </div>
      </form>`,
    onOpen: (root) => {
      $("#schedule-form", root).addEventListener("submit", async (event) => {
        event.preventDefault();
        const date = $("#schedule-date", root).value;
        const start = $("#schedule-start", root).value;
        const end = $("#schedule-end", root).value;
        state.schedule.push({ id: uid(), date, start, end, createdAt: new Date().toISOString() });
        await persist("Turno añadido al horario.");
        closeModal();
        renderDashboard();
        renderSchedule();
      });
    }
  });
}

function openCloseConfirmation(source) {
  const { clockIn, clockOut, items } = state.currentDay;
  if (source === "clock-out" && !clockIn) {
    showToast("Primero tienes que fichar la entrada.");
    return;
  }
  if (!clockIn && !items.length) {
    showToast("No hay una jornada ni trabajo que cerrar.");
    return;
  }

  const proposedOut = clockOut || new Date().toISOString();
  showModal({
    kicker: "Cierre de jornada",
    title: source === "clock-out" ? "Fichar salida" : "Cerrar día manualmente",
    content: `
      <p class="page-intro">
        Se guardarán ${items.length} ${items.length === 1 ? "registro" : "registros"} en el historial y el panel diario quedará limpio.
        El historial no se borrará.
      </p>
      <div class="punch-grid">
        <div><span>Entrada</span><strong>${formatTime(clockIn)}</strong></div>
        <div><span>Salida</span><strong>${formatTime(proposedOut)}</strong></div>
        <div class="wide"><span>Tiempo trabajado</span><strong>${formatMinutes(minutesBetween(clockIn, proposedOut))}</strong></div>
      </div>
      <div class="form-actions">
        <button class="secondary-action" type="button" data-close-modal>Cancelar</button>
        <button class="primary-action clock-out" id="confirm-close-day" type="button">Guardar y cerrar</button>
      </div>`,
    onOpen: (root) => {
      $("#confirm-close-day", root).addEventListener("click", () => closeDay(proposedOut));
    }
  });
}

async function closeDay(clockOut) {
  const day = state.currentDay;
  const record = {
    id: uid(),
    date: day.clockIn ? localDateKey(new Date(day.clockIn)) : day.date,
    clockIn: day.clockIn,
    clockOut: day.clockOut || clockOut,
    items: clone(day.items),
    closedAt: new Date().toISOString()
  };
  state.history.push(record);
  state.currentDay = {
    date: localDateKey(),
    clockIn: null,
    clockOut: null,
    items: []
  };
  await persist("Jornada guardada en el historial.");
  closeModal();
  renderAll();
  navigate("home");
}

async function clockIn() {
  if (state.currentDay.clockIn) return;
  const now = new Date();
  const hasExistingWork = state.currentDay.items.length > 0;
  if (!hasExistingWork) state.currentDay.date = localDateKey(now);
  state.currentDay.clockIn = now.toISOString();
  state.currentDay.clockOut = null;
  await persist(`Entrada fichada a las ${formatTime(state.currentDay.clockIn)}.`);
  renderDashboard();
}

function editCurrentOrLatest() {
  if (state.currentDay.clockIn || state.currentDay.clockOut) {
    openTimesForm(state.currentDay, false);
    return;
  }
  const latest = latestHistoryForDate(localDateKey());
  if (latest) openTimesForm(latest, true);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const payload = {
    app: "Turno Handling",
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    data: state
  };
  downloadFile(
    `turno-handling-backup-${localDateKey()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );
  showToast("Copia JSON preparada.");
}

async function importJson(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed.data || parsed;
    if (!Array.isArray(data.history) || !Array.isArray(data.schedule) || !data.currentDay) {
      throw new Error("Formato no válido");
    }
    const accepted = confirm(
      "Esta restauración reemplazará todos los datos actuales. Se recomienda exportar antes una copia. ¿Continuar?"
    );
    if (!accepted) return;
    state = await storage.replace(data);
    renderAll();
    showToast("Copia restaurada correctamente.");
  } catch (error) {
    console.error(error);
    showToast("El archivo no es una copia válida de Turno Handling.");
  } finally {
    $("#import-json-input").value = "";
  }
}

function csvCell(value) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function exportCsv() {
  const month = $("#csv-month").value;
  if (!month) {
    showToast("Selecciona un mes.");
    return;
  }
  const records = state.history.filter((record) => record.date.startsWith(month));
  if (!records.length) {
    showToast("No hay historial en ese mes.");
    return;
  }
  const rows = [
    [
      "Fecha",
      "Entrada",
      "Salida",
      "Horas",
      "Categoría",
      "Sección",
      "Parking",
      "Vuelo",
      "LIMAS",
      "Remolques",
      "Maquinaria / notas",
      "Estado"
    ]
  ];
  records.forEach((record) => {
    const items = record.items?.length ? record.items : [null];
    items.forEach((item) => {
      rows.push([
        record.date,
        formatTime(record.clockIn),
        formatTime(record.clockOut),
        (recordDuration(record) / 60).toFixed(2).replace(".", ","),
        item ? categoryName(item.category) : "",
        item?.section || "",
        item?.parking || "",
        item?.flight || "",
        item?.limas || "",
        item?.trailers || 0,
        item?.machineryNote || "",
        item ? (item.status === "done" ? "Hecho" : "Pendiente") : ""
      ]);
    });
  });
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  downloadFile(`turno-handling-${month}.csv`, csv, "text/csv;charset=utf-8");
  showToast("Historial mensual exportado.");
}

async function deleteAllData() {
  const first = confirm("¿Borrar todos los fichajes, vuelos, historial y horario de este dispositivo?");
  if (!first) return;
  const second = confirm("Esta acción no se puede deshacer. ¿Confirmas el borrado total?");
  if (!second) return;
  state = await storage.clear();
  renderAll();
  navigate("home");
  showToast("Todos los datos se han borrado.");
}

function openInstallHelp() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  showModal({
    kicker: "PWA offline",
    title: isStandalone ? "Ya está instalada" : "Instalar en iPhone",
    content: isStandalone
      ? '<p class="page-intro">Turno Handling se está ejecutando como app desde tu pantalla de inicio.</p>'
      : `
        <ol class="install-steps">
          <li>Abre la dirección de Turno Handling con <b>Safari</b>.</li>
          <li>Toca el botón <b>Compartir</b> (cuadrado con flecha hacia arriba).</li>
          <li>Desliza y elige <b>Añadir a pantalla de inicio</b>.</li>
          <li>Confirma el nombre <b>Turno Handling</b> y toca <b>Añadir</b>.</li>
          <li>Ábrela una vez desde el nuevo icono para dejar todos los archivos preparados sin conexión.</li>
        </ol>
        <p class="privacy-note">Safari necesita HTTPS para instalar el service worker. Una dirección HTTP de tu PC sirve para probar en la misma red, pero para instalar de forma fiable usa un alojamiento HTTPS.</p>`
  });
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("Este navegador no ofrece notificaciones web.");
    return;
  }
  if (Notification.permission === "granted") {
    showToast("Los avisos ya están activados.");
    return;
  }
  const permission = await Notification.requestPermission();
  state.settings.notificationsEnabled = permission === "granted";
  persist();
  renderSchedule();
  showToast(
    permission === "granted"
      ? "Avisos activados mientras la app esté abierta."
      : "Los avisos seguirán visibles dentro de la app."
  );
}

async function maybeShowNotifications(alerts) {
  if (!state?.settings?.notificationsEnabled || !("Notification" in window)) return;
  if (Notification.permission !== "granted" || document.visibilityState !== "visible") return;
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  alerts.slice(0, 2).forEach((alert) => {
    const key = `notified:${localDateKey()}:${alert.text}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const options = { body: alert.text, icon: "./icons/icon-192.png", tag: key };
    if (registration) {
      registration.showNotification("Turno Handling", options).catch(() => {});
    } else {
      try {
        new Notification("Turno Handling", options);
      } catch {
        // Los avisos dentro de la app siguen disponibles.
      }
    }
  });
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  $("#offline-banner").hidden = online;
  $("#connection-chip").textContent = online ? "Online" : "Offline";
  $("#connection-chip").classList.toggle("offline", !online);
  $("#storage-status").textContent = online
    ? "IndexedDB · datos solo en este dispositivo"
    : "IndexedDB activo · no se perderán los cambios";
}

function bindEvents() {
  $$(".nav-item").forEach((button) =>
    button.addEventListener("click", () => navigate(button.dataset.viewTarget))
  );
  $$("[data-go-view]").forEach((button) =>
    button.addEventListener("click", () => navigate(button.dataset.goView))
  );

  $("#clock-in-button").addEventListener("click", clockIn);
  $("#clock-out-button").addEventListener("click", () => openCloseConfirmation("clock-out"));
  $("#manual-close-button").addEventListener("click", () => openCloseConfirmation("manual"));
  $("#edit-current-times").addEventListener("click", editCurrentOrLatest);
  $("#add-schedule-button").addEventListener("click", openScheduleForm);
  $("#notifications-button").addEventListener("click", requestNotifications);
  $("#history-search").addEventListener("input", renderHistory);
  $("#export-json-button").addEventListener("click", exportJson);
  $("#export-csv-button").addEventListener("click", exportCsv);
  $("#import-json-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importJson(file);
  });
  $("#delete-all-button").addEventListener("click", deleteAllData);
  $("#install-help-button").addEventListener("click", openInstallHelp);

  $("#work-sections").addEventListener("click", async (event) => {
    const addButton = event.target.closest("[data-add-item]");
    const toggleButton = event.target.closest("[data-toggle-item]");
    const editButton = event.target.closest("[data-edit-item]");
    const deleteButton = event.target.closest("[data-delete-item]");
    const markAllButton = event.target.closest("[data-mark-all]");

    if (addButton) {
      const [category, section] = addButton.dataset.addItem.split("|");
      openItemForm(category, section);
    }
    if (toggleButton) {
      const item = state.currentDay.items.find((candidate) => candidate.id === toggleButton.dataset.toggleItem);
      if (!item) return;
      item.status = item.status === "pending" ? "done" : "pending";
      item.updatedAt = new Date().toISOString();
      await persist();
      renderDashboard();
      renderWork();
    }
    if (editButton) {
      const item = state.currentDay.items.find((candidate) => candidate.id === editButton.dataset.editItem);
      if (item) openItemForm(item.category, item.section, item);
    }
    if (deleteButton) {
      const item = state.currentDay.items.find((candidate) => candidate.id === deleteButton.dataset.deleteItem);
      if (!item || !confirm(`¿Eliminar ${item.flight || "este registro"} del panel de hoy?`)) return;
      state.currentDay.items = state.currentDay.items.filter(
        (candidate) => candidate.id !== deleteButton.dataset.deleteItem
      );
      await persist("Registro eliminado.");
      renderDashboard();
      renderWork();
    }
    if (markAllButton) {
      const [category, section] = markAllButton.dataset.markAll.split("|");
      state.currentDay.items
        .filter((item) => item.category === category && item.section === section)
        .forEach((item) => {
          item.status = "done";
          item.updatedAt = new Date().toISOString();
        });
      await persist("Sección completada.");
      renderDashboard();
      renderWork();
    }
  });

  $("#history-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-history]");
    if (!button) return;
    const record = state.history.find((candidate) => candidate.id === button.dataset.editHistory);
    if (record) openTimesForm(record, true);
  });

  $("#schedule-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-schedule]");
    if (!button) return;
    const shift = state.schedule.find((candidate) => candidate.id === button.dataset.deleteSchedule);
    if (!shift || !confirm(`¿Eliminar el turno del ${formatDate(shift.date)}?`)) return;
    state.schedule = state.schedule.filter((candidate) => candidate.id !== shift.id);
    persist("Turno eliminado.");
    renderDashboard();
    renderSchedule();
  });

  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", (event) => {
    if (event.target === $("#modal-backdrop") || event.target.closest("[data-close-modal]")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
  });
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.error("No se pudo registrar el service worker:", error);
  }
}

async function initialize() {
  try {
    state = await storage.load();
    navigator.storage?.persist?.().catch(() => {});
    bindEvents();
    renderAll();
    setInterval(() => {
      renderHeader();
      if (state.currentDay.clockIn) renderDashboard();
    }, 30000);
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <main class="app-shell">
        <article class="section-card">
          <h1>No se pudo abrir el almacenamiento local</h1>
          <p class="page-intro">Abre Turno Handling en Safari normal, fuera del modo privado, y vuelve a intentarlo.</p>
        </article>
      </main>`;
  }
}

initialize();
