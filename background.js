const browserApi = globalThis.browser ?? globalThis.chrome;

const LEGACY_STORAGE_KEY = "workspaceGroupSync.workspaces.v1";
const WORKSPACE_KEY_PREFIX = "workspaceGroupSync.workspace.";
const MAX_WORKSPACES = 100;
const TAB_GROUP_NONE = -1;
const SYNC_QUOTA_BYTES = 102400;
const SYNC_MAX_ITEM_BYTES = 8192;

browserApi.runtime.onMessage.addListener((message) => handleMessage(message));

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return getState();
    case "SAVE_GROUP":
      return saveGroup(message.groupId);
    case "RESTORE_WORKSPACE":
      return restoreWorkspace(message.workspaceId);
    case "DELETE_WORKSPACE":
      return deleteWorkspace(message.workspaceId);
    case "CLEAR_ALL_WORKSPACES":
      return clearAllWorkspaces();
    default:
      return { ok: false, error: "Ação desconhecida." };
  }
}

async function getState() {
  const supported = hasTabGroupsSupport();
  const [currentGroups, workspaceState] = await Promise.all([
    supported ? listCurrentWindowGroups() : Promise.resolve([]),
    getWorkspaceState(),
  ]);

  return {
    ok: true,
    supported,
    currentGroups,
    syncStatus: workspaceState.syncStatus,
    workspaces: sortWorkspaces(workspaceState.workspaces),
  };
}

function hasTabGroupsSupport() {
  return Boolean(
    browserApi?.tabs?.group &&
      browserApi?.tabs?.query &&
      browserApi?.tabGroups?.get &&
      browserApi?.tabGroups?.update
  );
}

async function listCurrentWindowGroups() {
  const tabs = await browserApi.tabs.query({ currentWindow: true });
  const groupedTabs = new Map();

  for (const tab of tabs.sort((a, b) => a.index - b.index)) {
    const groupId = typeof tab.groupId === "number" ? tab.groupId : TAB_GROUP_NONE;
    if (groupId === TAB_GROUP_NONE) continue;
    if (!groupedTabs.has(groupId)) groupedTabs.set(groupId, []);
    groupedTabs.get(groupId).push(tab);
  }

  const groups = [];
  for (const [groupId, tabsInGroup] of groupedTabs.entries()) {
    try {
      const group = await browserApi.tabGroups.get(groupId);
      groups.push({
        groupId,
        title: group.title || "Grupo sem nome",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed),
        windowId: group.windowId,
        tabCount: tabsInGroup.length,
        firstTabIndex: tabsInGroup[0]?.index ?? 0,
        preview: tabsInGroup.slice(0, 3).map((tab) => sanitizeText(tab.title || tab.url || "Nova aba")),
        tabs: tabsInGroup.map((tab) => ({
          url: tab.url || "about:blank",
          title: sanitizeText(tab.title || tab.url || "Nova aba"),
          restorable: isRestorableUrl(tab.url),
        })),
      });
    } catch {
      // Grupo pode ter sido removido entre a query e o get.
    }
  }

  return groups.sort((a, b) => a.firstTabIndex - b.firstTabIndex);
}

async function saveGroup(groupId) {
  if (!hasTabGroupsSupport()) {
    return { ok: false, error: "A API de grupos de abas não está disponível nesta versão do Firefox." };
  }

  const groups = await listCurrentWindowGroups();
  const group = groups.find((item) => item.groupId === groupId);
  if (!group) {
    return { ok: false, error: "Grupo não encontrado na janela atual." };
  }

  const tabUrls = group.tabs
    .filter((tab) => Boolean(tab.url))
    .map((tab) => tab.url);

  if (!tabUrls.length) {
    return { ok: false, error: "Não há abas para salvar neste grupo." };
  }

  const { workspaces } = await getWorkspaceState();
  const existing = workspaces
    .filter((item) => isSameWorkspaceKey(item, group))
    .sort(compareWorkspacesByFreshness)[0];

  const now = new Date().toISOString();
  const workspace = existing
    ? {
        ...existing,
        name: group.title || "Grupo sem nome",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed),
        updatedAt: now,
        tabUrls,
        meta: {
          originalTabCount: tabUrls.length,
        },
      }
    : {
        id: crypto.randomUUID(),
        name: group.title || "Grupo sem nome",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed),
        createdAt: now,
        updatedAt: now,
        tabUrls,
        meta: {
          originalTabCount: tabUrls.length,
        },
      };

  const duplicateIds = workspaces
    .filter((item) => item.id !== workspace.id && isSameWorkspaceKey(item, group))
    .map((item) => item.id);

  await Promise.all([
    saveWorkspaceToArea(browserApi.storage.sync, workspace, duplicateIds),
    saveWorkspaceToArea(browserApi.storage.local, workspace, duplicateIds),
  ]);

  const { syncStatus } = await getWorkspaceState();

  return {
    ok: true,
    message: existing
      ? `Grupo "${workspace.name}" atualizado no sync do Firefox.`
      : `Grupo "${workspace.name}" salvo e enviado para sincronização do Firefox.`,
    syncStatus,
    workspace,
  };
}

async function restoreWorkspace(workspaceId) {
  if (!hasTabGroupsSupport()) {
    return { ok: false, error: "A API de grupos de abas não está disponível nesta versão do Firefox." };
  }

  const workspaces = await loadWorkspaces();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return { ok: false, error: "Workspace salvo não encontrado." };
  }

  const currentWindow = await browserApi.windows.getCurrent();
  const existingTabs = await browserApi.tabs.query({ currentWindow: true });
  const startIndex = existingTabs.length;

  const createdTabIds = [];
  const skippedUrls = [];

  for (let i = 0; i < workspace.tabUrls.length; i += 1) {
    const url = workspace.tabUrls[i];
    if (!isRestorableUrl(url)) {
      skippedUrls.push(url);
      continue;
    }

    try {
      const created = await browserApi.tabs.create({
        windowId: currentWindow.id,
        url,
        index: startIndex + createdTabIds.length,
        active: createdTabIds.length === 0,
      });
      createdTabIds.push(created.id);
    } catch {
      skippedUrls.push(url);
    }
  }

  if (!createdTabIds.length) {
    return {
      ok: false,
      error: "Nenhuma aba do workspace pôde ser restaurada.",
      skippedUrls,
    };
  }

  const newGroupId = await browserApi.tabs.group({
    tabIds: createdTabIds,
    createProperties: { windowId: currentWindow.id },
  });

  await browserApi.tabGroups.update(newGroupId, {
    title: workspace.name || "Grupo restaurado",
    color: workspace.color || "grey",
    collapsed: Boolean(workspace.collapsed),
  });

  return {
    ok: true,
    message: `Workspace "${workspace.name}" restaurado em um novo grupo nesta janela.`,
    restoredTabCount: createdTabIds.length,
    skippedUrls,
  };
}

async function deleteWorkspace(workspaceId) {
  const workspaces = await loadWorkspaces();
  const exists = workspaces.some((item) => item.id === workspaceId);
  if (!exists) {
    return { ok: false, error: "Workspace não encontrado para exclusão." };
  }

  await Promise.all([
    deleteWorkspaceFromArea(browserApi.storage.sync, workspaceId),
    deleteWorkspaceFromArea(browserApi.storage.local, workspaceId),
  ]);

  return { ok: true, message: "Workspace excluído do sync da extensão." };
}

async function clearAllWorkspaces() {
  const [removedSync, removedLocal] = await Promise.all([
    clearWorkspacesFromArea(browserApi.storage.sync),
    clearWorkspacesFromArea(browserApi.storage.local),
  ]);
  const { syncStatus } = await getWorkspaceState();

  return {
    ok: true,
    message: `Todos os grupos salvos foram removidos. sync: ${removedSync}, cache local: ${removedLocal}.`,
    removedSync,
    removedLocal,
    syncStatus,
  };
}

async function loadWorkspaces() {
  const state = await getWorkspaceState();
  return state.workspaces;
}

async function getWorkspaceState() {
  const [syncState, localState] = await Promise.all([
    loadAreaWorkspaceState(browserApi.storage.sync),
    loadAreaWorkspaceState(browserApi.storage.local),
  ]);

  const merged = mergeWorkspaceSets(syncState.workspaces, localState.workspaces).slice(0, MAX_WORKSPACES);

  if (localState.available && shouldReplaceLocalCache(localState.workspaces, merged)) {
    await replaceAreaWorkspaces(browserApi.storage.local, localState.workspaces, merged);
    const refreshedLocalState = await loadAreaWorkspaceState(browserApi.storage.local);
    localState.workspaces = refreshedLocalState.workspaces;
    localState.bytesInUse = refreshedLocalState.bytesInUse;
    localState.keyPresent = refreshedLocalState.keyPresent;
  }

  return {
    workspaces: merged,
    syncStatus: {
      available: syncState.available,
      error: syncState.error,
      keyPresent: syncState.keyPresent,
      workspaceCount: syncState.workspaces.length,
      bytesInUse: syncState.bytesInUse,
      quotaBytes: SYNC_QUOTA_BYTES,
      maxItemBytes: SYNC_MAX_ITEM_BYTES,
      localBackupCount: localState.workspaces.length,
      localBytesInUse: localState.bytesInUse,
      source: syncState.workspaces.length ? "sync" : localState.workspaces.length ? "local" : "empty",
      checkedAt: new Date().toISOString(),
    },
  };
}

async function loadAreaWorkspaceState(area) {
  try {
    const allItems = await area.get(null);
    const legacyWorkspaces = Array.isArray(allItems?.[LEGACY_STORAGE_KEY])
      ? allItems[LEGACY_STORAGE_KEY].map(normalizeWorkspace).filter(Boolean)
      : [];
    const areaWorkspaces = Object.entries(allItems || {})
      .filter(([key]) => key.startsWith(WORKSPACE_KEY_PREFIX))
      .map(([, value]) => normalizeWorkspace(value))
      .filter(Boolean);

    const workspaces = mergeWorkspaceSets(areaWorkspaces, legacyWorkspaces);
    if (legacyWorkspaces.length > 0 || areaWorkspaces.length !== workspaces.length) {
      await replaceAreaWorkspaces(area, areaWorkspaces, workspaces);
    }

    return {
      available: true,
      error: "",
      keyPresent: areaWorkspaces.length > 0 || legacyWorkspaces.length > 0,
      workspaces,
      bytesInUse: await area.getBytesInUse(null),
    };
  } catch (error) {
    return {
      available: false,
      error: error?.message || String(error),
      keyPresent: false,
      workspaces: [],
      bytesInUse: 0,
    };
  }
}

async function saveWorkspaceToArea(area, workspace, duplicateIds = []) {
  const payload = {
    [workspaceStorageKey(workspace.id)]: workspace,
  };
  await area.set(payload);

  const keysToRemove = duplicateIds.map((id) => workspaceStorageKey(id));
  if (keysToRemove.length > 0) {
    await area.remove(keysToRemove);
  }

  await area.remove(LEGACY_STORAGE_KEY);
}

async function deleteWorkspaceFromArea(area, workspaceId) {
  await area.remove([workspaceStorageKey(workspaceId), LEGACY_STORAGE_KEY]);
}

async function clearWorkspacesFromArea(area) {
  try {
    const keys = await getWorkspaceKeysFromArea(area);
    if (!keys.length) return 0;
    await area.remove(keys);
    return keys.length;
  } catch {
    return 0;
  }
}

async function getWorkspaceKeysFromArea(area) {
  const allItems = await area.get(null);
  const workspaceKeys = Object.keys(allItems || {}).filter((key) => key.startsWith(WORKSPACE_KEY_PREFIX));
  return allItems && Object.prototype.hasOwnProperty.call(allItems, LEGACY_STORAGE_KEY)
    ? [...workspaceKeys, LEGACY_STORAGE_KEY]
    : workspaceKeys;
}

async function replaceAreaWorkspaces(area, currentWorkspaces, nextWorkspaces) {
  const nextPayload = {};
  for (const workspace of nextWorkspaces) {
    nextPayload[workspaceStorageKey(workspace.id)] = workspace;
  }

  if (Object.keys(nextPayload).length > 0) {
    await area.set(nextPayload);
  }

  const nextKeys = new Set(Object.keys(nextPayload));
  const keysToRemove = currentWorkspaces
    .map((workspace) => workspaceStorageKey(workspace.id))
    .filter((key) => !nextKeys.has(key));

  keysToRemove.push(LEGACY_STORAGE_KEY);
  await area.remove(keysToRemove);
}

function mergeWorkspaceSets(primaryWorkspaces, secondaryWorkspaces) {
  const byId = new Map();

  for (const workspace of [...primaryWorkspaces, ...secondaryWorkspaces]) {
    const current = byId.get(workspace.id);
    if (!current || compareWorkspacesByFreshness(workspace, current) < 0) {
      byId.set(workspace.id, workspace);
    }
  }

  const byLogicalKey = new Map();
  for (const workspace of byId.values()) {
    const logicalKey = getWorkspaceLogicalKey(workspace.name, workspace.color);
    const current = byLogicalKey.get(logicalKey);
    if (!current || compareWorkspacesByFreshness(workspace, current) < 0) {
      byLogicalKey.set(logicalKey, workspace);
    }
  }

  return sortWorkspaces(Array.from(byLogicalKey.values()));
}

function normalizeWorkspace(workspace) {
  if (!workspace || !Array.isArray(workspace.tabUrls)) return null;

  const now = new Date().toISOString();
  return {
    id: String(workspace.id || crypto.randomUUID()),
    name: sanitizeText(workspace.name || "Grupo sem nome") || "Grupo sem nome",
    color: String(workspace.color || "grey"),
    collapsed: Boolean(workspace.collapsed),
    createdAt: String(workspace.createdAt || workspace.updatedAt || now),
    updatedAt: String(workspace.updatedAt || workspace.createdAt || now),
    tabUrls: workspace.tabUrls.filter((url) => typeof url === "string" && url.length > 0),
    meta: {
      originalTabCount: Number(workspace?.meta?.originalTabCount || workspace.tabUrls.length || 0),
    },
  };
}

function sortWorkspaces(workspaces) {
  return [...workspaces].sort(compareWorkspacesByFreshness);
}

function compareWorkspacesByFreshness(a, b) {
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function shouldReplaceLocalCache(currentWorkspaces, nextWorkspaces) {
  return getWorkspaceSignature(currentWorkspaces) !== getWorkspaceSignature(nextWorkspaces);
}

function getWorkspaceSignature(workspaces) {
  return sortWorkspaces(workspaces)
    .map((workspace) => `${workspace.id}:${workspace.updatedAt}:${workspace.tabUrls.length}`)
    .join("|");
}

function workspaceStorageKey(workspaceId) {
  return `${WORKSPACE_KEY_PREFIX}${workspaceId}`;
}

function sanitizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isSameWorkspaceKey(workspace, group) {
  return getWorkspaceLogicalKey(workspace?.name, workspace?.color) === getWorkspaceLogicalKey(group?.title, group?.color);
}

function getWorkspaceLogicalKey(name, color) {
  return `${normalizeWorkspaceName(name)}::${String(color || "grey")}`;
}

function normalizeWorkspaceName(value) {
  return sanitizeText(value || "Grupo sem nome").toLocaleLowerCase();
}

function isRestorableUrl(url) {
  if (!url || typeof url !== "string") return false;
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url === "about:blank" ||
    url === "about:newtab"
  );
}
