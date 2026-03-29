const browserApi = globalThis.browser ?? globalThis.chrome;

const STORAGE_KEY = "workspaceGroupSync.workspaces.v1";
const MAX_WORKSPACES = 100;
const TAB_GROUP_NONE = -1;

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
    default:
      return { ok: false, error: "Ação desconhecida." };
  }
}

async function getState() {
  const supported = hasTabGroupsSupport();
  const [currentGroups, workspaces] = await Promise.all([
    supported ? listCurrentWindowGroups() : Promise.resolve([]),
    loadWorkspaces(),
  ]);

  return {
    ok: true,
    supported,
    currentGroups,
    workspaces: workspaces.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
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

  const now = new Date().toISOString();
  const workspaces = await loadWorkspaces();
  const existing = workspaces
    .filter((item) => isSameWorkspaceKey(item, group))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];

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

  const next = [
    workspace,
    ...workspaces.filter((item) => item.id !== workspace.id && !isSameWorkspaceKey(item, group)),
  ].slice(0, MAX_WORKSPACES);
  await saveWorkspaces(next);

  return {
    ok: true,
    message: existing
      ? `Grupo "${workspace.name}" atualizado no sync do Firefox.`
      : `Grupo "${workspace.name}" salvo e enviado para sincronização do Firefox.`,
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

  const next = workspaces.filter((item) => item.id !== workspaceId);
  await saveWorkspaces(next);
  return { ok: true, message: "Workspace excluído do sync da extensão." };
}

async function loadWorkspaces() {
  const result = await browserApi.storage.sync.get(STORAGE_KEY);
  const items = result?.[STORAGE_KEY];
  return Array.isArray(items) ? items : [];
}

async function saveWorkspaces(workspaces) {
  await browserApi.storage.sync.set({ [STORAGE_KEY]: workspaces });
}

function sanitizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isSameWorkspaceKey(workspace, group) {
  return (
    normalizeWorkspaceName(workspace?.name) === normalizeWorkspaceName(group?.title) &&
    String(workspace?.color || "grey") === String(group?.color || "grey")
  );
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
