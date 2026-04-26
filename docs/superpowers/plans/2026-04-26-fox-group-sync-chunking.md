# Fox Group Sync Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement payload chunking and minimization in `background.js` to bypass Firefox's 8KB `storage.sync` item limit, allowing synchronization of large tab groups.

**Architecture:** 
1. **Payload Minimization:** Remove `favIconUrl` from saved data, as it consumes massive space (base64) and is already enriched dynamically by `popup.js` for open tabs. Remove redundant `tabUrls` array.
2. **Chunking:** Split `tabEntries` into chunks of 40 tabs max (~6KB). Save the workspace metadata in a `.meta` key and the tabs in `.c0`, `.c1`, etc. keys.
3. **Reassembly:** When loading from storage, group keys by workspace ID, reassemble the chunks, and seamlessly migrate legacy single-key workspaces.

**Tech Stack:** Plain JavaScript (WebExtensions API).

---

### Task 1: Payload Minimization in `saveGroup`

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Remove `favIconUrl` from `tabEntries` generation**
In `saveGroup`, locate the mapping of `group.tabs` to `tabEntries`. Remove the `favIconUrl` property to save storage space.

```javascript
  const tabEntries = group.tabs
    .filter((tab) => Boolean(tab.url))
    .map((tab) => ({
      url: tab.url,
      title: sanitizeText(tab.title || tab.url || "Nova aba"),
    }));
```

- [ ] **Step 2: Remove `tabUrls` from workspace object creation**
In `saveGroup`, remove `tabUrls` from the `workspace` object creation (both `existing` and new object paths). `tabUrls` is redundant.

```javascript
  const workspace = existing
    ? {
        ...existing,
        name: group.title || "Grupo sem nome",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed),
        updatedAt: now,
        tabEntries,
        meta: {
          originalTabCount: tabEntries.length,
        },
      }
    : {
        id: crypto.randomUUID(),
        name: group.title || "Grupo sem nome",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed),
        createdAt: now,
        updatedAt: now,
        tabEntries,
        meta: {
          originalTabCount: tabEntries.length,
        },
      };
```

---

### Task 2: Add Chunking Constants and Helpers

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add chunking constants at the top of the file**
Below `const SYNC_MAX_ITEM_BYTES = 8192;`, add:

```javascript
const MAX_TABS_PER_CHUNK = 40;
const MAX_CHUNKS_TO_CLEANUP = 50; // Covers up to 2000 tabs per group
```

- [ ] **Step 2: Add helper `getWorkspaceKeysForDeletion`**
Add this function to generate all possible keys for a given workspace ID (legacy, meta, and chunks).

```javascript
function getWorkspaceKeysForDeletion(workspaceId) {
  const keys = [
    `${WORKSPACE_KEY_PREFIX}${workspaceId}`, // Legacy V2 key
    `${WORKSPACE_KEY_PREFIX}${workspaceId}.meta`
  ];
  for (let i = 0; i < MAX_CHUNKS_TO_CLEANUP; i++) {
    keys.push(`${WORKSPACE_KEY_PREFIX}${workspaceId}.c${i}`);
  }
  return keys;
}
```

- [ ] **Step 3: Update `deleteWorkspaceFromArea`**
Update it to use the new helper.

```javascript
async function deleteWorkspaceFromArea(area, workspaceId) {
  const keysToRemove = getWorkspaceKeysForDeletion(workspaceId);
  keysToRemove.push(LEGACY_STORAGE_KEY);
  await area.remove(keysToRemove);
}
```

---

### Task 3: Implement Chunked Saving

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Update `saveWorkspaceToArea`**
Rewrite this function to split `workspace.tabEntries` into chunks and save them as separate keys.

```javascript
async function saveWorkspaceToArea(area, workspace, duplicateIds = []) {
  const payload = {};
  
  const meta = { ...workspace };
  delete meta.tabEntries;
  delete meta.tabUrls;
  
  const tabEntries = workspace.tabEntries || [];
  const chunks = [];
  for (let i = 0; i < tabEntries.length; i += MAX_TABS_PER_CHUNK) {
    chunks.push(tabEntries.slice(i, i + MAX_TABS_PER_CHUNK));
  }
  
  meta.chunkCount = chunks.length;
  
  payload[`${WORKSPACE_KEY_PREFIX}${workspace.id}.meta`] = meta;
  chunks.forEach((chunk, index) => {
    payload[`${WORKSPACE_KEY_PREFIX}${workspace.id}.c${index}`] = chunk;
  });

  await area.set(payload);

  const keysToRemove = [];
  duplicateIds.forEach((id) => {
    keysToRemove.push(...getWorkspaceKeysForDeletion(id));
  });
  
  // Clean up legacy V2 key for this workspace if it existed
  keysToRemove.push(`${WORKSPACE_KEY_PREFIX}${workspace.id}`);
  keysToRemove.push(LEGACY_STORAGE_KEY);
  
  if (keysToRemove.length > 0) {
    await area.remove(keysToRemove);
  }
}
```

- [ ] **Step 2: Update `replaceAreaWorkspaces`**
Rewrite it to handle chunks when replacing all workspaces.

```javascript
async function replaceAreaWorkspaces(area, currentWorkspaces, nextWorkspaces) {
  const nextPayload = {};
  
  for (const workspace of nextWorkspaces) {
    const meta = { ...workspace };
    delete meta.tabEntries;
    delete meta.tabUrls;
    
    const tabEntries = workspace.tabEntries || [];
    const chunks = [];
    for (let i = 0; i < tabEntries.length; i += MAX_TABS_PER_CHUNK) {
      chunks.push(tabEntries.slice(i, i + MAX_TABS_PER_CHUNK));
    }
    
    meta.chunkCount = chunks.length;
    nextPayload[`${WORKSPACE_KEY_PREFIX}${workspace.id}.meta`] = meta;
    chunks.forEach((chunk, index) => {
      nextPayload[`${WORKSPACE_KEY_PREFIX}${workspace.id}.c${index}`] = chunk;
    });
  }

  if (Object.keys(nextPayload).length > 0) {
    await area.set(nextPayload);
  }

  const nextWorkspaceIds = new Set(nextWorkspaces.map(w => String(w.id)));
  const keysToRemove = [];
  
  for (const workspace of currentWorkspaces) {
    if (!nextWorkspaceIds.has(String(workspace.id))) {
      keysToRemove.push(...getWorkspaceKeysForDeletion(workspace.id));
    }
  }

  keysToRemove.push(LEGACY_STORAGE_KEY);
  if (keysToRemove.length > 0) {
    await area.remove(keysToRemove);
  }
}
```

---

### Task 4: Implement Chunked Loading and Reassembly

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Rewrite `loadAreaWorkspaceState`**
Update the parsing logic to reassemble chunks and handle legacy V2 keys seamlessly.

```javascript
async function loadAreaWorkspaceState(area) {
  try {
    const allItems = await area.get(null);
    const legacyWorkspaces = Array.isArray(allItems?.[LEGACY_STORAGE_KEY])
      ? allItems[LEGACY_STORAGE_KEY].map(normalizeWorkspace).filter(Boolean)
      : [];
      
    const chunksByWorkspace = {};
    const legacyV2Workspaces = [];

    for (const [key, value] of Object.entries(allItems || {})) {
      if (key.startsWith(WORKSPACE_KEY_PREFIX)) {
        const suffix = key.substring(WORKSPACE_KEY_PREFIX.length);
        const parts = suffix.split('.');
        const id = parts[0];
        const type = parts[1];

        if (!type) {
          legacyV2Workspaces.push(value);
          continue;
        }

        if (!chunksByWorkspace[id]) chunksByWorkspace[id] = { chunks: [] };
        if (type === 'meta') {
          chunksByWorkspace[id].meta = value;
        } else if (type.startsWith('c')) {
          const index = parseInt(type.substring(1), 10);
          chunksByWorkspace[id].chunks[index] = value;
        }
      }
    }

    const reassembledWorkspaces = [];
    for (const data of Object.values(chunksByWorkspace)) {
      if (data.meta) {
        const workspace = { ...data.meta };
        workspace.tabEntries = [];
        for (let i = 0; i < (workspace.chunkCount || 0); i++) {
          if (data.chunks[i]) {
            workspace.tabEntries.push(...data.chunks[i]);
          }
        }
        reassembledWorkspaces.push(workspace);
      }
    }

    const rawAreaWorkspaces = [...reassembledWorkspaces, ...legacyV2Workspaces];
    const areaWorkspaces = rawAreaWorkspaces.map(normalizeWorkspace).filter(Boolean);

    const workspaces = mergeWorkspaceSets(areaWorkspaces, legacyWorkspaces);
    
    // Force a rewrite if we have legacy formats or if merging changed the count
    const hasLegacyData = legacyWorkspaces.length > 0 || legacyV2Workspaces.length > 0;
    if (hasLegacyData || rawAreaWorkspaces.length !== workspaces.length) {
      await replaceAreaWorkspaces(area, areaWorkspaces, workspaces);
    }

    return {
      available: true,
      error: "",
      keyPresent: rawAreaWorkspaces.length > 0 || legacyWorkspaces.length > 0,
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
```

- [ ] **Step 2: Update `getWorkspaceKeysFromArea`**
Ensure it returns all keys (meta and chunks) correctly. It currently filters by prefix, which is already correct, but let's ensure it's robust.
*No changes needed to `getWorkspaceKeysFromArea` because `key.startsWith(WORKSPACE_KEY_PREFIX)` correctly matches `.meta`, `.c0`, and legacy V2 keys.*

---

### Task 5: Ensure Normalization Consistency

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Update `normalizeWorkspaceTabEntries`**
Ensure it handles objects that might not have `favIconUrl` safely (since we removed it in Task 1).

```javascript
function normalizeWorkspaceTabEntries(workspace) {
  if (Array.isArray(workspace.tabEntries) && workspace.tabEntries.length) {
    return workspace.tabEntries
      .filter((tab) => typeof tab?.url === "string" && tab.url.length > 0)
      .map((tab) => ({
        url: tab.url,
        title: sanitizeText(tab.title || tab.url || "Nova aba"),
        favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : "",
      }));
  }

  if (Array.isArray(workspace.tabUrls) && workspace.tabUrls.length) {
    return workspace.tabUrls
      .filter((url) => typeof url === "string" && url.length > 0)
      .map((url) => ({
        url,
        title: sanitizeText(url),
        favIconUrl: "",
      }));
  }

  return [];
}
```
*(Self-review: The existing `normalizeWorkspaceTabEntries` already handles missing `favIconUrl` properly via `typeof tab.favIconUrl === "string" ? tab.favIconUrl : ""`. No actual change needed here, but good to verify).*

- [ ] **Step 2: Update `normalizeWorkspace`**
Ensure `tabUrls` is generated dynamically and `tabEntries` is preserved.

```javascript
function normalizeWorkspace(workspace) {
  if (!workspace || (!Array.isArray(workspace.tabUrls) && !Array.isArray(workspace.tabEntries))) return null;

  const now = new Date().toISOString();
  const tabEntries = normalizeWorkspaceTabEntries(workspace);
  if (!tabEntries.length) return null;
  const tabUrls = tabEntries.map((tab) => tab.url);

  return {
    id: String(workspace.id || crypto.randomUUID()),
    name: sanitizeText(workspace.name || "Grupo sem nome") || "Grupo sem nome",
    color: String(workspace.color || "grey"),
    collapsed: Boolean(workspace.collapsed),
    createdAt: String(workspace.createdAt || workspace.updatedAt || now),
    updatedAt: String(workspace.updatedAt || workspace.createdAt || now),
    tabEntries,
    tabUrls, // Reconstructed dynamically here
    meta: normalizeWorkspaceMeta(workspace?.meta, tabUrls.length),
  };
}
```
*(Self-review: The existing `normalizeWorkspace` already does exactly this. It reconstructs `tabUrls` from `tabEntries`. So no changes are needed in `normalizeWorkspace`!)*

---

### Task 6: Manual Testing Steps

Since there is no automated test suite, follow these manual steps in Firefox:

- [ ] **Step 1: Test saving a large group**
1. Load the extension via `about:debugging`.
2. Open a group with 50+ tabs.
3. Save the group to sync.
4. Verify in the popup that the sync status shows success and the bytes in use reflect the chunked data.

- [ ] **Step 2: Test migration**
1. Revert to the old code, save a group.
2. Load the new code.
3. Verify the group still appears in the popup.
4. Save the group again, verify it converts to the chunked format in `about:debugging` storage inspector.

- [ ] **Step 3: Test deletion**
1. Delete the saved group.
2. Verify all chunks and `.meta` keys are removed from storage.
