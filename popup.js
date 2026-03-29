const browserApi = globalThis.browser ?? globalThis.chrome;

const currentGroupsEl = document.getElementById("currentGroups");
const savedWorkspacesEl = document.getElementById("savedWorkspaces");
const noticeEl = document.getElementById("notice");
const btnRefresh = document.getElementById("btnRefresh");

btnRefresh.addEventListener("click", () => loadState());
document.addEventListener("DOMContentLoaded", () => loadState());

async function loadState() {
  showNotice("", "");
  try {
    const state = await browserApi.runtime.sendMessage({ type: "GET_STATE" });

    if (!state?.supported) {
      renderUnsupported();
      return;
    }

    renderCurrentGroups(state.currentGroups || []);
    renderSavedWorkspaces(state.workspaces || []);
  } catch (error) {
    renderError(`Falha ao carregar a extensão: ${error?.message || error}`);
  }
}

function renderUnsupported() {
  currentGroupsEl.innerHTML = `<div class="empty">Esta versão do Firefox não expõe as APIs necessárias para grupos de abas.</div>`;
  savedWorkspacesEl.innerHTML = `<div class="empty">Sem suporte a restauração de grupos nesta instalação.</div>`;
}

function renderError(message) {
  currentGroupsEl.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  savedWorkspacesEl.innerHTML = "";
}

function renderCurrentGroups(groups) {
  if (!groups.length) {
    currentGroupsEl.innerHTML = `<div class="empty">Nenhum grupo nativo aberto na janela atual.</div>`;
    return;
  }

  currentGroupsEl.innerHTML = groups
    .map(
      (group) => `
        <article class="card">
          <div class="card-header">
            <div class="card-title">
              <span class="color-dot" style="background:${escapeHtml(colorToCss(group.color))}"></span>
              <span class="name">${escapeHtml(group.title)}</span>
            </div>
            <span class="meta">${group.tabCount} abas</span>
          </div>
          <ul class="preview">
            ${group.preview.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
          <div class="actions">
            <button data-action="save" data-group-id="${group.groupId}">Salvar no sync</button>
          </div>
        </article>
      `
    )
    .join("");

  currentGroupsEl.querySelectorAll("[data-action='save']").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await browserApi.runtime.sendMessage({
          type: "SAVE_GROUP",
          groupId: Number(button.dataset.groupId),
        });

        if (!response?.ok) {
          showNotice(response?.error || "Não foi possível salvar o grupo.", "error");
        } else {
          showNotice(response.message, "success");
          await loadState();
        }
      } catch (error) {
        showNotice(`Erro ao salvar: ${error?.message || error}`, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderSavedWorkspaces(workspaces) {
  if (!workspaces.length) {
    savedWorkspacesEl.innerHTML = `<div class="empty">Ainda não existe nenhum grupo salvo no sync da extensão.</div>`;
    return;
  }

  savedWorkspacesEl.innerHTML = workspaces
    .map(
      (workspace) => `
        <article class="card">
          <div class="card-header">
            <div class="card-title">
              <span class="color-dot" style="background:${escapeHtml(colorToCss(workspace.color))}"></span>
              <span class="name">${escapeHtml(workspace.name)}</span>
            </div>
            <span class="meta">${workspace.tabUrls.length} abas</span>
          </div>
          <div class="meta">Última atualização: ${escapeHtml(formatDate(workspace.updatedAt))}</div>
          <div class="actions">
            <button data-action="restore" data-workspace-id="${workspace.id}">Abrir grupo</button>
            <button class="danger" data-action="delete" data-workspace-id="${workspace.id}">Excluir</button>
          </div>
        </article>
      `
    )
    .join("");

  savedWorkspacesEl.querySelectorAll("[data-action='restore']").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await browserApi.runtime.sendMessage({
          type: "RESTORE_WORKSPACE",
          workspaceId: button.dataset.workspaceId,
        });

        if (!response?.ok) {
          showNotice(response?.error || "Não foi possível restaurar o workspace.", "error");
          return;
        }

        const skipped = response.skippedUrls?.length
          ? ` ${response.skippedUrls.length} aba(s) foram ignoradas por URL não restaurável.`
          : "";
        showNotice(`${response.message}${skipped}`, "success");
      } catch (error) {
        showNotice(`Erro ao restaurar: ${error?.message || error}`, "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  savedWorkspacesEl.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await browserApi.runtime.sendMessage({
          type: "DELETE_WORKSPACE",
          workspaceId: button.dataset.workspaceId,
        });

        if (!response?.ok) {
          showNotice(response?.error || "Não foi possível excluir o workspace.", "error");
        } else {
          showNotice(response.message, "success");
          await loadState();
        }
      } catch (error) {
        showNotice(`Erro ao excluir: ${error?.message || error}`, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
