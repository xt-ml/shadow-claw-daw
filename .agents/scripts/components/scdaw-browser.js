/**
 * .agents/scripts/components/scdaw-browser.js
 *
 * Left Sidebar Browser Web Component (<scdaw-browser>).
 * Ported concepts from openDAW BrowserPanel & DeviceCatalog.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { INSTRUMENT_PRESETS, GENRE_TEMPLATES } from "../scdaw-presets.js";
import { DEFAULT_GROUP_ID, formatFileSize, getFileIcon } from "../scdaw-fs.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function filterBrowserItems(items, query = "", tab = "all") {
  const cleanQ = query.trim().toLowerCase();
  const cleanTab = tab.toLowerCase();
  const tabSingular = cleanTab.endsWith("s") ? cleanTab.slice(0, -1) : cleanTab;

  return items.filter((item) => {
    if (cleanTab !== "all") {
      const itemType = (item.type || "").toLowerCase();
      const itemCat = (item.category || "").toLowerCase();
      const matchesType = itemType === cleanTab || itemType === tabSingular;
      const matchesCat = itemCat === cleanTab || itemCat === tabSingular;
      if (!matchesType && !matchesCat) {
        return false;
      }
    }
    if (!cleanQ) return true;
    return (
      item.name.toLowerCase().includes(cleanQ) ||
      (item.category && item.category.toLowerCase().includes(cleanQ))
    );
  });
}

export class DawBrowserElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._activeTab = "presets";
    this._searchQuery = "";
    this._activeConversationId = DEFAULT_GROUP_ID;
    this._conversations = [];
    this._conversationFiles = [];
    this._filesLoaded = false;
  }

  connectedCallback() {
    this.render();
  }

  async loadFilesForConversation(groupId = DEFAULT_GROUP_ID) {
    this._activeConversationId = groupId || DEFAULT_GROUP_ID;
    try {
      this._conversations = await scdaw.listConversations();
      this._conversationFiles = await scdaw.listConversationFiles(
        this._activeConversationId,
      );
    } catch (_) {
      this._conversationFiles = [];
    }
    this._filesLoaded = true;
    this.render();
  }

  _getItems() {
    const items = [];

    // Files in active conversation
    if (this._activeTab === "files" || this._activeTab === "all") {
      for (const file of this._conversationFiles) {
        items.push({
          id: `file_${file.name}`,
          name: file.name,
          rawName: file.name,
          type: "files",
          category: file.format,
          size: file.size,
          format: file.format,
          isProject: file.isProject,
          isAudio: file.isAudio,
        });
      }
    }
    // Presets
    for (const [name, data] of Object.entries(INSTRUMENT_PRESETS)) {
      items.push({
        id: `preset_${name}`,
        name: name.replace("-", " ").toUpperCase(),
        rawName: name,
        type: "presets",
        category: "Synth Preset",
        data,
      });
    }
    // Genre Grooves
    for (const name of Object.keys(GENRE_TEMPLATES)) {
      items.push({
        id: `genre_${name}`,
        name: `${name.toUpperCase()} (Groove)`,
        rawName: name,
        type: "presets",
        category: "Genre Template",
      });
    }
    // Instruments
    items.push({
      id: "dev_vaporisateur",
      name: "Vaporisateur",
      type: "devices",
      category: "Instrument",
      kind: "synth",
    });
    items.push({
      id: "dev_playfield",
      name: "Playfield (12-Drum Kit)",
      type: "devices",
      category: "Instrument",
      kind: "drums",
    });
    // Audio FX
    items.push({
      id: "fx_fold",
      name: "Fold (Wavefolder)",
      type: "devices",
      category: "Audio FX",
    });
    items.push({
      id: "fx_crusher",
      name: "Crusher (Bitcrush)",
      type: "devices",
      category: "Audio FX",
    });
    items.push({
      id: "fx_delay",
      name: "Delay (Stereo Echo)",
      type: "devices",
      category: "Audio FX",
    });
    items.push({
      id: "fx_reverb",
      name: "Reverb (Plate)",
      type: "devices",
      category: "Audio FX",
    });
    items.push({
      id: "fx_stereo",
      name: "StereoTool (Width)",
      type: "devices",
      category: "Audio FX",
    });
    // MIDI FX
    items.push({
      id: "mfx_arp",
      name: "Arpeggiator",
      type: "devices",
      category: "MIDI FX",
    });
    items.push({
      id: "mfx_pitch",
      name: "Pitch Transpose",
      type: "devices",
      category: "MIDI FX",
    });

    return items;
  }

  render() {
    if (!this.shadowRoot) return;
    const allItems = this._getItems();
    const filtered = filterBrowserItems(
      allItems,
      this._searchQuery,
      this._activeTab,
    );

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-width: 220px;
        }
        .browser-header {
          display: flex;
          gap: 4px;
          margin-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 0.4rem;
        }
        .tab-btn {
          flex: 1;
          padding: 0.3rem 0.2rem;
          font-size: 0.72rem;
          text-align: center;
          background: transparent;
          border: none;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          cursor: pointer;
          border-radius: 4px;
          font-weight: 600;
        }
        .tab-btn.active {
          background: var(--bg-elevated);
          color: var(--accent);
        }
        .search-box {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          color: inherit;
          padding: 0.35rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          margin-bottom: 0.5rem;
        }
        .item-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .browser-item {
          padding: 0.4rem 0.6rem;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.75rem;
          transition: background 0.1s;
        }
        .browser-item:hover {
          background: var(--bg-elevated);
          color: var(--accent);
        }
      </style>
      <div class="daw-panel" style="padding:0.75rem; height:100%; display:flex; flex-direction:column;">
        <div class="browser-header">
          <button class="tab-btn ${this._activeTab === "presets" ? "active" : ""}" data-tab="presets">Presets</button>
          <button class="tab-btn ${this._activeTab === "devices" ? "active" : ""}" data-tab="devices">Devices</button>
          <button class="tab-btn ${this._activeTab === "files" ? "active" : ""}" data-tab="files">Files</button>
          <button class="tab-btn ${this._activeTab === "all" ? "active" : ""}" data-tab="all">All</button>
        </div>

        ${
          this._activeTab === "files"
            ? `
          <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label for="browser-conversation-select" style="font-size:0.72rem; font-weight:600; color:var(--shadow-claw-text-secondary, #94a3b8);">Conversation</label>
              <button type="button" class="browser-refresh-files-btn btn btn-icon" title="Refresh files" style="padding:1px 5px; font-size:0.7rem;">🔄</button>
            </div>
            <select class="browser-conversation-select" id="browser-conversation-select" style="padding:0.35rem; background:var(--bg-elevated); color:inherit; border:1px solid var(--border); border-radius:4px; font-size:0.75rem;">
              ${(this._conversations.length
                ? this._conversations
                : [{ groupId: DEFAULT_GROUP_ID, name: "Main", isDefault: true }]
              )
                .map(
                  (c) =>
                    `<option value="${c.groupId}" ${c.groupId === this._activeConversationId ? "selected" : ""}>${c.name}${c.isDefault ? " (Default)" : ""}</option>`,
                )
                .join("")}
            </select>
          </div>
        `
            : ""
        }

        <input type="text" class="search-box" placeholder="${this._activeTab === "files" ? "Search conversation files..." : "Search presets & devices..."}" value="${this._searchQuery}" />
        <div class="item-list">
          ${
            this._activeTab === "files" && filtered.length === 0
              ? `
            <div style="padding:1.5rem 0.5rem; text-align:center; color:var(--shadow-claw-text-secondary, #94a3b8); font-size:0.75rem;">
              No files found in this conversation.<br/>
              <span style="font-size:0.68rem; opacity:0.8;">Save a project or bounce to this conversation.</span>
            </div>
          `
              : filtered
                  .map(
                    (item) => `
            <div class="browser-item" draggable="true" role="button" tabindex="0" aria-label="${item.name} (${item.category}). Drag to track or press Enter to apply." data-id="${item.id}" data-type="${item.type}" data-name="${item.rawName || item.name}" data-kind="${item.kind || ""}" data-category="${item.category || ""}" data-format="${item.format || ""}">
              <span style="display:flex; align-items:center; gap:6px;">
                ${item.type === "files" ? `<span aria-hidden="true">${getFileIcon(item.name)}</span>` : ""}
                <span>${item.name}</span>
              </span>
              <span style="display:flex; align-items:center; gap:6px;">
                <span class="badge" style="font-size:0.65rem;">${item.category}</span>
                ${item.size ? `<span style="font-size:0.65rem; color:var(--shadow-claw-text-secondary, #94a3b8);">${formatFileSize(item.size)}</span>` : ""}
              </span>
            </div>
          `,
                  )
                  .join("")
          }
        </div>
      </div>
    `;

    // Tab buttons
    this.shadowRoot.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._activeTab = e.target.dataset.tab;
        if (this._activeTab === "files" && !this._filesLoaded) {
          this.loadFilesForConversation(this._activeConversationId);
        } else {
          this.render();
        }
      });
    });

    // Conversation select
    const convSelect = this.shadowRoot.querySelector(
      ".browser-conversation-select",
    );
    convSelect?.addEventListener("change", (e) => {
      this.loadFilesForConversation(e.target.value);
    });

    // Refresh files button
    const refreshBtn = this.shadowRoot.querySelector(
      ".browser-refresh-files-btn",
    );
    refreshBtn?.addEventListener("click", () => {
      this.loadFilesForConversation(this._activeConversationId);
    });

    // Search input
    const searchInput = this.shadowRoot.querySelector(".search-box");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this._searchQuery = e.target.value;
        this.render();
      });
    }

    // Item click and drag handlers
    this.shadowRoot.querySelectorAll(".browser-item").forEach((el) => {
      // Drag source
      el.addEventListener("dragstart", (e) => {
        const type = el.dataset.type;
        const name = el.dataset.name;
        if (type === "files") {
          const filePayload = {
            filename: name,
            format: el.dataset.format,
            conversationId: this._activeConversationId,
          };
          e.dataTransfer?.setData(
            "application/x-scdaw-file",
            JSON.stringify(filePayload),
          );
          e.dataTransfer?.setData("text/plain", name);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
          el.style.opacity = "0.5";
          return;
        }

        const kind =
          el.dataset.kind ||
          (el.dataset.category?.includes("FX")
            ? "audio_fx"
            : type === "presets"
              ? "preset"
              : "instrument");
        const pluginPayload = {
          id: el.dataset.id,
          name,
          type,
          kind,
          category: el.dataset.category,
        };
        e.dataTransfer?.setData(
          "application/x-scdaw-plugin",
          JSON.stringify(pluginPayload),
        );
        e.dataTransfer?.setData("text/plain", JSON.stringify(pluginPayload));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
        el.style.opacity = "0.5";
      });

      el.addEventListener("dragend", () => {
        el.style.opacity = "1.0";
      });

      // Keyboard accessibility
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });

      el.addEventListener("click", async () => {
        const type = el.dataset.type;
        const name = el.dataset.name;
        const kind = el.dataset.kind;

        if (type === "files") {
          try {
            await scdaw.loadProjectFromFs({
              conversationId: this._activeConversationId,
              filename: name,
            });
          } catch (err) {
            console.error("Error opening file from browser:", err);
          }
          return;
        }

        if (name && (name.includes("Groove") || GENRE_TEMPLATES[name])) {
          await scdaw.sendCommand("new_project", { template: name });
        } else if (type === "presets") {
          const p = scdaw.getProject();
          const targetTrack =
            p.tracks.find((t) => t.kind === "synth") || p.tracks[0];
          if (targetTrack) {
            await scdaw.sendCommand("apply_preset", {
              trackId: targetTrack.id,
              preset: name,
            });
          }
        } else if (kind) {
          await scdaw.sendCommand("add_track", {
            kind,
            name: el.innerText.trim(),
          });
        }
      });
    });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-browser")
) {
  customElements.define("scdaw-browser", DawBrowserElement);
}
