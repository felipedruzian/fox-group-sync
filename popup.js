const browserApi = globalThis.browser ?? globalThis.chrome;

const UPDATE_CONFIRM_PREFS_KEY = "workspaceGroupSync.updateConfirmSkipByKey.v1";

const currentGroupsEl = document.getElementById("currentGroups");
const savedWorkspacesEl = document.getElementById("savedWorkspaces");
const syncStatusEl = document.getElementById("syncStatus");
const noticeEl = document.getElementById("notice");
const btnRefresh = document.getElementById("btnRefresh");
const btnRefreshSaved = document.getElementById("btnRefreshSaved");
const btnClearAll = document.getElementById("btnClearAll");
const syncLoaderEl = document.getElementById("syncLoader");

const updateConfirmModalEl = document.getElementById("updateConfirmModal");
const updateConfirmMessageEl = document.getElementById("updateConfirmMessage");
const diffAddedListEl = document.getElementById("diffAddedList");
const diffRemovedListEl = document.getElementById("diffRemovedList");
const dontAskAgainCheckboxEl = document.getElementById("dontAskAgainCheckbox");
const cancelUpdateBtn = document.getElementById("cancelUpdateBtn");
const confirmUpdateBtn = document.getElementById("confirmUpdateBtn");

let pendingOperations = 0;
let updateConfirmPrefs = {};
let prefsLoaded = false;
let updateConfirmResolver = null;

btnRefresh.addEventListener("click", () => loadState({ showLoading: true }));
btnRefreshSaved.addEventListener("click", () => loadState({ showLoading: true }));
btnClearAll.addEventListener("click", () => clearAllWorkspaces());
cancelUpdateBtn.addEventListener("click", () => finishUpdateConfirmation(false));
confirmUpdateBtn.addEventListener("click", () => finishUpdateConfirmation(true));
updateConfirmModalEl.addEventListener("click", (event) => {
  if (event.target === updateConfirmModalEl) {
    finishUpdateConfirmation(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && updateConfirmModalEl.classList.contains("show")) {
    finishUpdateConfirmation(false);
  }
});
document.addEventListener("DOMContentLoaded", () => loadState({ showLoading: true }));

browserApi.storage?.sync?.onChanged?.addListener((_changes, areaName) => {
  if (areaName === "sync") {
    loadState({ showLoading: false });
  }
});

async function loadState(options = {}) {
  const showLoading = options.showLoading !== false;
  if (showLoading) setLoading(true);
  showNotice("", "");

  try {
    await ensureUpdateConfirmPrefsLoaded();
    const state = await browserApi.runtime.sendMessage({ type: "GET_STATE" });
    renderSyncStatus(state?.syncStatus);

    if (!state?.supported) {
      renderCurrentUnsupported();
      renderSavedWorkspaces(state.workspaces || [], []);
      return;
    }

    renderCurrentGroups(state.currentGroups || [], state.workspaces || []);
    renderSavedWorkspaces(state.workspaces || [], state.currentGroups || []);
  } catch (error) {
    renderError(`Falha ao carregar a extensao: ${error?.message || error}`);
  } finally {
    if (showLoading) setLoading(false);
  }
}

async function ensureUpdateConfirmPrefsLoaded() {
  if (prefsLoaded) return;

  try {
    const result = await browserApi.storage.local.get(UPDATE_CONFIRM_PREFS_KEY);
    const prefs = result?.[UPDATE_CONFIRM_PREFS_KEY];
    updateConfirmPrefs = prefs && typeof prefs === "object" ? prefs : {};
  } catch {
    updateConfirmPrefs = {};
  } finally {
    prefsLoaded = true;
  }
}

function renderCurrentUnsupported() {
  currentGroupsEl.innerHTML = `<div class="empty">Esta versao do Firefox nao expoe as APIs necessarias para grupos de abas.</div>`;
}

function renderError(message) {
  currentGroupsEl.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  savedWorkspacesEl.innerHTML = `<div class="empty">Nao foi possivel carregar os workspaces salvos.</div>`;
  syncStatusEl.textContent = "";
}

function renderCurrentGroups(groups, workspaces) {
  if (!groups.length) {
    currentGroupsEl.innerHTML = `<div class="empty">Nenhum grupo nativo aberto na janela atual.</div>`;
    return;
  }

  const groupsById = new Map(groups.map((group) => [String(group.groupId), group]));
  const syncedWorkspaceByKey = getSyncedWorkspaceByKey(workspaces);

  currentGroupsEl.innerHTML = groups
    .map((group) => {
      const groupEntries = getGroupTabEntries(group);
      const logicalKey = getWorkspaceLogicalKey(group.title, group.color);
      const existingSynced = syncedWorkspaceByKey.get(logicalKey);
      const actionText = existingSynced ? "Atualizar sync" : "Salvar no sync";

      return `
        <article class="card">
          <div class="card-header">
            <div class="card-title">
              <span class="color-dot" style="background:${escapeHtml(colorToCss(group.color))}"></span>
              <span class="name">${escapeHtml(group.title)}</span>
              <span class="tab-total">(${group.tabCount})</span>
            </div>
          </div>
          ${renderTabPreview(groupEntries, `local-${group.groupId}`)}
          <div class="actions">
            <button data-action="save" data-group-id="${group.groupId}">${actionText}</button>
          </div>
        </article>
      `;
    })
    .join("");

  currentGroupsEl.querySelectorAll("[data-action='save']").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = groupsById.get(String(button.dataset.groupId));
      if (!group) return;

      const groupEntries = getGroupTabEntries(group);
      const logicalKey = getWorkspaceLogicalKey(group.title, group.color);
      const existingSynced = syncedWorkspaceByKey.get(logicalKey);

      button.disabled = true;
      setLoading(true);
      try {
        if (existingSynced && shouldAskUpdateConfirmation(logicalKey)) {
          const syncedEntries = getWorkspaceTabEntries(existingSynced);
          const diff = buildTabDiff(groupEntries, syncedEntries);
          const decision = await askUpdateConfirmation({
            groupName: group.title || "Grupo sem nome",
            groupColor: group.color || "grey",
            addedTabs: diff.added,
            removedTabs: diff.removed,
          });

          if (!decision.confirmed) return;
          if (decision.skipFuture) {
            await setSkipUpdateConfirmation(logicalKey, true);
          }
        }

        const response = await browserApi.runtime.sendMessage({
          type: "SAVE_GROUP",
          groupId: Number(group.groupId),
        });

        if (!response?.ok) {
          showNotice(response?.error || "Nao foi possivel salvar o grupo.", "error");
        } else {
          showNotice(formatSaveMessage(response), "success");
          await loadState({ showLoading: false });
        }
      } catch (error) {
        showNotice(`Erro ao salvar: ${error?.message || error}`, "error");
      } finally {
        setLoading(false);
        button.disabled = false;
      }
    });
  });
}

function renderSavedWorkspaces(workspaces, currentGroups) {
  if (!workspaces.length) {
    savedWorkspacesEl.innerHTML = `<div class="empty">Ainda nao existe nenhum grupo salvo no sync da extensao.</div>`;
    return;
  }

  const localMetadataByGroupKey = getLocalMetadataByGroupKey(currentGroups || []);

  savedWorkspacesEl.innerHTML = workspaces
    .map((workspace) => {
      const groupKey = getWorkspaceLogicalKey(workspace.name, workspace.color);
      const localMetadataByUrl = localMetadataByGroupKey.get(groupKey) || new Map();
      const tabEntries = enrichWorkspaceTabEntries(getWorkspaceTabEntries(workspace), localMetadataByUrl);
      const sourceText = formatWorkspaceSource(workspace);

      return `
        <article class="card">
          <div class="card-header">
            <div class="card-title">
              <span class="color-dot" style="background:${escapeHtml(colorToCss(workspace.color))}"></span>
              <span class="name">${escapeHtml(workspace.name)}</span>
              <span class="tab-total">(${tabEntries.length})</span>
            </div>
          </div>
          ${renderTabPreview(tabEntries, `saved-${workspace.id}`)}
          <div class="meta">${escapeHtml(sourceText)}</div>
          <div class="meta">Ultima atualizacao: ${escapeHtml(formatDate(workspace.updatedAt))}</div>
          <div class="actions">
            <button data-action="restore" data-workspace-id="${workspace.id}">Abrir grupo</button>
            <button class="danger" data-action="delete" data-workspace-id="${workspace.id}">Excluir</button>
          </div>
        </article>
      `;
    })
    .join("");

  savedWorkspacesEl.querySelectorAll("[data-action='restore']").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setLoading(true);
      try {
        const response = await browserApi.runtime.sendMessage({
          type: "RESTORE_WORKSPACE",
          workspaceId: button.dataset.workspaceId,
        });

        if (!response?.ok) {
          showNotice(response?.error || "Nao foi possivel restaurar o workspace.", "error");
          return;
        }

        const skipped = response.skippedUrls?.length
          ? ` ${response.skippedUrls.length} aba(s) foram ignoradas por URL nao restauravel.`
          : "";
        showNotice(`${response.message}${skipped}`, "success");
      } catch (error) {
        showNotice(`Erro ao restaurar: ${error?.message || error}`, "error");
      } finally {
        setLoading(false);
        button.disabled = false;
      }
    });
  });

  savedWorkspacesEl.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setLoading(true);
      try {
        const response = await browserApi.runtime.sendMessage({
          type: "DELETE_WORKSPACE",
          workspaceId: button.dataset.workspaceId,
        });

        if (!response?.ok) {
          showNotice(response?.error || "Nao foi possivel excluir o workspace.", "error");
        } else {
          showNotice(response.message, "success");
          await loadState({ showLoading: false });
        }
      } catch (error) {
        showNotice(`Erro ao excluir: ${error?.message || error}`, "error");
      } finally {
        setLoading(false);
        button.disabled = false;
      }
    });
  });
}

async function clearAllWorkspaces() {
  const confirmed = globalThis.confirm(
    "Isso vai remover todos os grupos salvos no storage.sync e no cache local desta extensao. Deseja continuar?"
  );
  if (!confirmed) return;

  btnClearAll.disabled = true;
  setLoading(true);
  try {
    const response = await browserApi.runtime.sendMessage({ type: "CLEAR_ALL_WORKSPACES" });
    if (!response?.ok) {
      showNotice(response?.error || "Nao foi possivel limpar os grupos salvos.", "error");
      return;
    }

    showNotice(response.message, "success");
    await loadState({ showLoading: false });
  } catch (error) {
    showNotice(`Erro ao limpar grupos salvos: ${error?.message || error}`, "error");
  } finally {
    setLoading(false);
    btnClearAll.disabled = false;
  }
}

function renderSyncStatus(syncStatus) {
  if (!syncStatus?.available) {
    const localBackup = syncStatus?.localBackupCount
      ? ` Cache local: ${syncStatus.localBackupCount} grupo(s).`
      : "";
    syncStatusEl.textContent = `storage.sync: nao foi possivel verificar o estado agora.${localBackup}`;
    return;
  }

  const usage = `${formatBytes(syncStatus.bytesInUse)} / ${formatBytes(syncStatus.quotaBytes)}`;
  const localUsage = `cache local: ${syncStatus.localBackupCount || 0} grupo(s), ${formatBytes(syncStatus.localBytesInUse)} usados.`;
  const source = `origem atual: ${syncStatus.source || "desconhecida"}.`;

  if (syncStatus.workspaceCount > 0) {
    syncStatusEl.textContent = `storage.sync: ${syncStatus.workspaceCount} grupo(s) encontrado(s), ${usage} usados. ${localUsage} ${source}`;
    return;
  }

  if (syncStatus.localBackupCount > 0) {
    syncStatusEl.textContent = `storage.sync: vazio para esta extensao, ${usage} usados. Exibindo ${localUsage} ${source}`;
    return;
  }

  syncStatusEl.textContent = syncStatus.keyPresent
    ? `storage.sync: nenhuma entrada valida encontrada, ${usage} usados. ${localUsage} ${source}`
    : `storage.sync: vazio para esta extensao, ${usage} usados. ${localUsage} ${source}`;
}

function renderTabPreview(tabEntries, sectionId) {
  if (!tabEntries.length) {
    return `<div class="empty">Sem abas neste grupo.</div>`;
  }

  const previewEntries = tabEntries.slice(0, 3);
  const remainingEntries = tabEntries.slice(3);
  const previewItems = previewEntries.map((tab) => renderTabItem(tab)).join("");
  const detailsId = safeDomId(sectionId);
  const details = remainingEntries.length > 0
    ? `
      <details class="tabs-details" id="${detailsId}">
        <summary>Mostrar demais abas (${remainingEntries.length})</summary>
        <ul class="preview">
          ${remainingEntries.map((tab) => renderTabItem(tab)).join("")}
        </ul>
      </details>
    `
    : "";

  return `
    <ul class="preview">
      ${previewItems}
    </ul>
    ${details}
  `;
}

function renderTabItem(tab) {
  const label = getTabLabel(tab);
  const tooltip = formatTabTooltip(tab);
  const favicon = tab?.favIconUrl
    ? `<img class="tab-favicon" src="${escapeAttr(tab.favIconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`
    : `<span class="tab-favicon placeholder" aria-hidden="true">${escapeHtml(getFallbackIconGlyphAscii(tab?.url))}</span>`;

  return `
    <li class="tab-item" title="${escapeAttr(tooltip)}">
      <div class="tab-row">
        ${favicon}
        <span class="tab-text">${escapeHtml(label)}</span>
      </div>
    </li>
  `;
}

function getGroupTabEntries(group) {
  return (group?.tabs || [])
    .filter((tab) => typeof tab?.url === "string" && tab.url.length > 0)
    .map((tab) => ({
      url: tab.url,
      title: sanitizeText(tab.title || tab.url || "Nova aba"),
      favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : "",
    }));
}

function getLocalMetadataByGroupKey(groups) {
  const byGroupKey = new Map();

  for (const group of groups || []) {
    const groupKey = getWorkspaceLogicalKey(group.title, group.color);
    const byUrl = new Map();

    for (const tab of group.tabs || []) {
      if (!tab?.url) continue;
      const title = sanitizeText(tab.title || "");
      const favIconUrl = typeof tab.favIconUrl === "string" ? tab.favIconUrl : "";
      byUrl.set(tab.url, { title, favIconUrl });
    }

    byGroupKey.set(groupKey, byUrl);
  }

  return byGroupKey;
}

function getWorkspaceTabEntries(workspace) {
  if (Array.isArray(workspace?.tabEntries) && workspace.tabEntries.length) {
    return workspace.tabEntries
      .filter((tab) => typeof tab?.url === "string" && tab.url.length > 0)
      .map((tab) => ({
        url: tab.url,
        title: sanitizeText(tab.title || tab.url || "Nova aba"),
        favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : "",
      }));
  }

  return (workspace?.tabUrls || [])
    .filter((url) => typeof url === "string" && url.length > 0)
    .map((url) => ({
      url,
      title: sanitizeText(url),
      favIconUrl: "",
    }));
}

function formatWorkspaceSource(workspace) {
  const sourceDeviceLabel = sanitizeText(workspace?.meta?.sourceDevice?.label || "");
  if (workspace?.inSync) {
    return sourceDeviceLabel ? `Origem: ${sourceDeviceLabel}` : "Origem: storage.sync";
  }

  if (sourceDeviceLabel) {
    return `Origem: ${sourceDeviceLabel} (cache local)`;
  }

  return "Origem: cache local";
}

function enrichWorkspaceTabEntries(entries, localMetadataByUrl) {
  return entries.map((entry) => {
    const localMeta = localMetadataByUrl.get(entry.url);
    if (!localMeta) return entry;

    const currentTitle = sanitizeText(entry.title || "");
    const shouldReplaceTitle = !currentTitle || currentTitle === entry.url;
    const title = shouldReplaceTitle && localMeta.title ? localMeta.title : currentTitle || entry.url;
    const favIconUrl = entry.favIconUrl || localMeta.favIconUrl || "";

    return {
      ...entry,
      title,
      favIconUrl,
    };
  });
}

function getTabLabel(tab) {
  const title = sanitizeText(tab?.title || "");
  if (title) return title;
  return sanitizeText(tab?.url || "Nova aba");
}

function formatTabTooltip(tab) {
  const title = sanitizeText(tab?.title || "");
  const url = sanitizeText(tab?.url || "");
  if (title && url && title !== url) return `${title}:\n${url}`;
  if (url) return url;
  return title || "Nova aba";
}

function getFallbackIconGlyphAscii(url) {
  try {
    const host = new URL(url).hostname || "";
    return host ? host[0].toUpperCase() : "*";
  } catch {
    return "*";
  }
}

function getSyncedWorkspaceByKey(workspaces) {
  const byKey = new Map();

  for (const workspace of workspaces || []) {
    if (!workspace?.inSync) continue;

    const logicalKey = getWorkspaceLogicalKey(workspace.name, workspace.color);
    const current = byKey.get(logicalKey);
    if (!current || String(workspace.updatedAt).localeCompare(String(current.updatedAt)) > 0) {
      byKey.set(logicalKey, workspace);
    }
  }

  return byKey;
}

function getWorkspaceLogicalKey(name, color) {
  return `${normalizeName(name)}::${String(color || "grey")}`;
}

function normalizeName(value) {
  return sanitizeText(value || "Grupo sem nome").toLocaleLowerCase();
}

function sanitizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function shouldAskUpdateConfirmation(logicalKey) {
  return !updateConfirmPrefs?.[logicalKey];
}

async function setSkipUpdateConfirmation(logicalKey, skipFuture) {
  updateConfirmPrefs = {
    ...updateConfirmPrefs,
    [logicalKey]: Boolean(skipFuture),
  };
  await browserApi.storage.local.set({ [UPDATE_CONFIRM_PREFS_KEY]: updateConfirmPrefs });
}

function buildTabDiff(localEntries, syncedEntries) {
  const localByUrl = new Map(localEntries.map((tab) => [tab.url, tab]));
  const syncByUrl = new Map(syncedEntries.map((tab) => [tab.url, tab]));

  const added = localEntries.filter((tab) => !syncByUrl.has(tab.url));
  const removed = syncedEntries.filter((tab) => !localByUrl.has(tab.url));

  return { added, removed };
}

function askUpdateConfirmation(payload) {
  return new Promise((resolve) => {
    if (updateConfirmResolver) {
      updateConfirmResolver({ confirmed: false, skipFuture: false });
      updateConfirmResolver = null;
    }

    updateConfirmResolver = resolve;
    dontAskAgainCheckboxEl.checked = false;
    updateConfirmMessageEl.textContent = `Grupo: ${payload.groupName} (${payload.groupColor}). Revise as diferencas antes de atualizar.`;
    renderDiffList(diffAddedListEl, payload.addedTabs, "Nenhuma aba adicionada.");
    renderDiffList(diffRemovedListEl, payload.removedTabs, "Nenhuma aba removida.");
    updateConfirmModalEl.classList.add("show");
    updateConfirmModalEl.setAttribute("aria-hidden", "false");
  });
}

function renderDiffList(targetEl, tabs, emptyLabel) {
  if (!tabs.length) {
    targetEl.innerHTML = `<li class="tab-item"><span class="tab-text">${escapeHtml(emptyLabel)}</span></li>`;
    return;
  }

  targetEl.innerHTML = tabs
    .map((tab) => `<li class="tab-item" title="${escapeHtml(tab.title)}"><span class="tab-text">${escapeHtml(tab.title)}</span></li>`)
    .join("");
}

function finishUpdateConfirmation(confirmed) {
  if (!updateConfirmResolver) return;

  const resolver = updateConfirmResolver;
  updateConfirmResolver = null;
  updateConfirmModalEl.classList.remove("show");
  updateConfirmModalEl.setAttribute("aria-hidden", "true");
  resolver({
    confirmed,
    skipFuture: confirmed && dontAskAgainCheckboxEl.checked,
  });
}

function safeDomId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

function formatSaveMessage(response) {
  const syncStatus = response?.syncStatus;
  if (!syncStatus?.available) {
    return response.message;
  }

  return `${response.message} storage.sync: ${syncStatus.workspaceCount} grupo(s), ${formatBytes(syncStatus.bytesInUse)} usados. cache local: ${syncStatus.localBackupCount || 0} grupo(s).`;
}

function showNotice(message, type) {
  noticeEl.textContent = message;
  noticeEl.className = "notice";
  if (message) {
    noticeEl.classList.add("show");
    if (type) noticeEl.classList.add(type);
  }
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value || "-";
  }
}

function colorToCss(color) {
  const map = {
    grey: "#94a3b8",
    blue: "#60a5fa",
    red: "#f87171",
    yellow: "#facc15",
    green: "#4ade80",
    pink: "#f472b6",
    purple: "#a78bfa",
    cyan: "#22d3ee",
    orange: "#fb923c",
  };
  return map[color] || "#94a3b8";
}

function setLoading(isLoading) {
  pendingOperations = isLoading ? pendingOperations + 1 : Math.max(0, pendingOperations - 1);
  syncLoaderEl.classList.toggle("show", pendingOperations > 0);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}
