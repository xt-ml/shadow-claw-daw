/**
 * ShadowClaw DAW — DAWproject v1.0 Format Interop Codec (scdaw-dawproject.js)
 *
 * Implements pure-JS zero-dependency XML parsing/serialization and .dawproject v1.0
 * interchange format reader/writer, enabling lossless project sharing between
 * ShadowClaw DAW, openDAW, Bitwig Studio, Studio One, and PreSonus ecosystem.
 *
 * Architecture:
 * - Pure-JS XML AST generator & tokenizer (zero browser DOM dependencies)
 * - DAWproject v1.0 schema mapping:
 *   - <Application>, <Transport> (Tempo, TimeSignature)
 *   - <Structure> (<Track>, <Channel>, <Devices>, <Equalizer>)
 *   - <Arrangement> (<Lanes timeUnit="beats">, <Clips>, <Notes>)
 * - ZIP container packing & unpacking via scdaw-zip.js
 *
 * @license AGPL-3.0-or-later
 */

import { PPQN, createProject, resolveTrackNotes } from "./scdaw.js";
import { encodeZip, decodeZip } from "./scdaw-zip.js";

/**
 * Escapes XML entity characters.
 * @param {string} str
 * @returns {string}
 */
export function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Unescapes XML entity characters.
 * @param {string} str
 * @returns {string}
 */
export function unescapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Creates an XML element descriptor.
 * @param {string} tag
 * @param {Record<string, any>} [attributes={}]
 * @param {Array<object|string>} [children=[]]
 * @returns {object}
 */
export function xmlElement(tag, attributes = {}, children = []) {
  return {
    tag,
    attributes: { ...attributes },
    children: Array.isArray(children) ? children : [children],
    text: "",
  };
}

/**
 * Serializes an XML element AST into a formatted XML string.
 * @param {object} node
 * @param {number} [indent=0]
 * @returns {string}
 */
export function serializeXmlNode(node, indent = 0) {
  if (typeof node === "string") {
    return escapeXml(node);
  }
  const spaces = "    ".repeat(indent);
  const attrs = Object.entries(node.attributes || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");

  if (!node.children || node.children.length === 0) {
    if (node.text) {
      return `${spaces}<${node.tag}${attrs}>${escapeXml(node.text)}</${node.tag}>`;
    }
    return `${spaces}<${node.tag}${attrs}/>`;
  }

  // If only simple string children
  if (node.children.length === 1 && typeof node.children[0] === "string") {
    return `${spaces}<${node.tag}${attrs}>${escapeXml(node.children[0])}</${node.tag}>`;
  }

  const childLines = node.children
    .map((c) => serializeXmlNode(c, indent + 1))
    .join("\n");

  return `${spaces}<${node.tag}${attrs}>\n${childLines}\n${spaces}</${node.tag}>`;
}

/**
 * Serializes an XML element into a complete XML document string.
 * @param {object} rootNode
 * @returns {string}
 */
export function serializeXmlDocument(rootNode) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${serializeXmlNode(rootNode, 0)}`;
}

/**
 * Pure-JS zero-dependency XML tree parser.
 * Converts an XML string into an AST { tag, attributes, children, text }.
 * @param {string} xmlString
 * @returns {object} Root AST node
 */
export function parseXml(xmlString) {
  // Strip XML declaration, doctypes, and comments
  let clean = xmlString
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  let pos = 0;
  const len = clean.length;

  function parseAttributes(attrStr) {
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = attrRegex.exec(attrStr)) !== null) {
      attrs[match[1]] = unescapeXml(
        match[2] !== undefined ? match[2] : match[3],
      );
    }
    return attrs;
  }

  function parseNode() {
    // Skip whitespace
    while (pos < len && /\s/.test(clean[pos])) pos++;
    if (pos >= len) return null;

    if (clean[pos] !== "<") {
      // Text node
      const start = pos;
      while (pos < len && clean[pos] !== "<") pos++;
      const text = unescapeXml(clean.slice(start, pos).trim());
      return text ? { text } : null;
    }

    if (clean.slice(pos, pos + 2) === "</") {
      return null; // Closing tag encountered by caller
    }

    // Opening or self-closing tag
    const tagEnd = clean.indexOf(">", pos);
    if (tagEnd === -1) throw new Error(`Malformed XML near position ${pos}`);

    const tagContent = clean.slice(pos + 1, tagEnd).trim();
    const isSelfClosing = tagContent.endsWith("/");
    const tagBody = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;

    const firstSpace = tagBody.search(/\s/);
    let tagName;
    let attrStr = "";
    if (firstSpace === -1) {
      tagName = tagBody;
    } else {
      tagName = tagBody.slice(0, firstSpace);
      attrStr = tagBody.slice(firstSpace + 1);
    }

    const attributes = parseAttributes(attrStr);
    pos = tagEnd + 1;

    if (isSelfClosing) {
      return { tag: tagName, attributes, children: [], text: "" };
    }

    // Parse children until closing tag
    const children = [];
    let text = "";

    while (pos < len) {
      // Check for closing tag
      if (clean.slice(pos, pos + 2) === "</") {
        const closeEnd = clean.indexOf(">", pos);
        if (closeEnd === -1)
          throw new Error(`Malformed closing tag near position ${pos}`);
        const closeTag = clean.slice(pos + 2, closeEnd).trim();
        pos = closeEnd + 1;
        if (closeTag !== tagName) {
          // Mismatched closing tag, close current and let caller handle
        }
        break;
      }

      if (clean[pos] === "<") {
        const child = parseNode();
        if (child) {
          if (child.text && !child.tag) {
            text += (text ? " " : "") + child.text;
          } else {
            children.push(child);
          }
        }
      } else {
        const textStart = pos;
        while (pos < len && clean[pos] !== "<") pos++;
        const t = unescapeXml(clean.slice(textStart, pos).trim());
        if (t) text += (text ? " " : "") + t;
      }
    }

    return { tag: tagName, attributes, children, text };
  }

  const root = parseNode();
  if (!root) throw new Error("Failed to parse XML: empty document");
  return root;
}

/**
 * Encodes a ShadowClaw project into a .dawproject ZIP archive.
 * @param {object} project
 * @param {object} [options]
 * @returns {ArrayBuffer}
 */
export function encodeDawProject(project, options = {}) {
  const bpm = Number(project.bpm) || 120;
  const name = project.name || project.title || "Untitled";
  const sigNum = project.signature?.[0] || 4;
  const sigDen = project.signature?.[1] || 4;
  const lengthBars = project.lengthBars || 1;
  const totalBeats = lengthBars * sigNum;
  const tracks = project.tracks || [];

  // 1. Build metadata.xml
  const metaDoc = serializeXmlDocument(
    xmlElement("MetaData", {}, [
      xmlElement("Title", {}, [name]),
      xmlElement("Artist", {}, ["ShadowClaw DAW"]),
      xmlElement("Album", {}, [""]),
      xmlElement("OriginalArtist", {}, [""]),
      xmlElement("Songwriter", {}, [""]),
      xmlElement("Producer", {}, ["ShadowClaw Agent"]),
      xmlElement("Year", {}, [String(new Date().getFullYear())]),
      xmlElement("Genre", {}, ["Electronic"]),
      xmlElement("Comment", {}, ["Created with ShadowClaw DAW"]),
    ]),
  );

  // 2. Build Structure and Track Nodes
  let idCounter = 0;
  const nextId = () => `id${idCounter++}`;
  const encoder = new TextEncoder();
  const extraFiles = [];

  const tempoId = nextId();
  const timeSigId = nextId();

  const structureTracks = [];
  const trackIdMap = new Map(); // track.id -> { trackId, channelId }
  const masterChannelId = nextId();

  tracks.forEach((track, idx) => {
    const tId = nextId();
    const chId = nextId();
    trackIdMap.set(track.id || `trk_${idx}`, { trackId: tId, channelId: chId });
    const safeTrackId = (track.id || `trk_${idx}`).replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );

    const isDrums =
      track.type === "drums" || track.kind === "drums" || track.id === "drums";
    const volLinear = track.volume !== undefined ? track.volume : 0.8;
    const panNorm = track.pan !== undefined ? (track.pan + 1) / 2 : 0.5;

    const channelChildren = [
      xmlElement("Mute", {
        value: String(Boolean(track.mute)),
        id: nextId(),
        name: "Mute",
      }),
      xmlElement("Pan", {
        min: "0.000000",
        max: "1.000000",
        unit: "normalized",
        value: panNorm.toFixed(6),
        id: nextId(),
        name: "Pan",
      }),
      xmlElement("Volume", {
        min: "0.000000",
        max: "2.000000",
        unit: "linear",
        value: volLinear.toFixed(6),
        id: nextId(),
        name: "Volume",
      }),
    ];

    const deviceElements = [];

    // Save instrument params state
    if (track.params && Object.keys(track.params).length > 0) {
      const instPresetPath = `presets/inst_${safeTrackId}.json`;
      extraFiles.push({
        name: instPresetPath,
        data: encoder.encode(JSON.stringify(track.params, null, 2)),
      });
      deviceElements.push(
        xmlElement(
          "BuiltinDevice",
          {
            deviceRole: "instrument",
            deviceName: isDrums ? "Playfield" : "Vaporisateur",
            deviceVendor: "ShadowClaw",
            loaded: "true",
            id: nextId(),
          },
          [
            xmlElement("State", { path: instPresetPath, external: "false" }),
            xmlElement("Enabled", { value: "true", id: nextId() }),
          ],
        ),
      );
    }

    // Save MIDI FX state
    if (Array.isArray(track.midiFx) && track.midiFx.length > 0) {
      track.midiFx.forEach((fx, fxIdx) => {
        const midiFxPresetPath = `presets/midifx_${safeTrackId}_${fxIdx}.json`;
        extraFiles.push({
          name: midiFxPresetPath,
          data: encoder.encode(JSON.stringify(fx, null, 2)),
        });
        deviceElements.push(
          xmlElement(
            "BuiltinDevice",
            {
              deviceRole: "noteFX",
              deviceName: fx.type || "midiFx",
              deviceVendor: "ShadowClaw",
              loaded: "true",
              id: nextId(),
            },
            [
              xmlElement("State", {
                path: midiFxPresetPath,
                external: "false",
              }),
              xmlElement("Enabled", { value: "true", id: nextId() }),
            ],
          ),
        );
      });
    }

    // If track has audioFx (e.g. equalizer)
    if (Array.isArray(track.audioFx) && track.audioFx.length > 0) {
      for (const fx of track.audioFx) {
        if (fx.type === "equalizer") {
          const bands = (fx.bands || []).map((b) =>
            xmlElement(
              "Band",
              { type: b.type || "bell", order: String(b.order || 2) },
              [
                xmlElement("Freq", {
                  min: "20.000000",
                  max: "20000.000000",
                  unit: "hertz",
                  value: (b.freq || 1000).toFixed(6),
                  id: nextId(),
                }),
                xmlElement("Gain", {
                  min: "-30.000000",
                  max: "30.000000",
                  unit: "decibel",
                  value: (b.gain || 0).toFixed(6),
                  id: nextId(),
                }),
                xmlElement("Q", {
                  min: "0.100000",
                  max: "30.000000",
                  unit: "linear",
                  value: (b.q || 1.0).toFixed(6),
                  id: nextId(),
                }),
                xmlElement("Enabled", { value: "true", id: nextId() }),
              ],
            ),
          );
          deviceElements.push(
            xmlElement(
              "Equalizer",
              {
                deviceName: fx.name || "Equalizer",
                deviceRole: "audioFX",
                loaded: "true",
                id: nextId(),
              },
              [
                xmlElement("Enabled", { value: "true", id: nextId() }),
                ...bands,
              ],
            ),
          );
        } else {
          const fxPresetPath = `presets/fx_${safeTrackId}_${fx.id || fx.type}.json`;
          extraFiles.push({
            name: fxPresetPath,
            data: encoder.encode(JSON.stringify(fx, null, 2)),
          });
          deviceElements.push(
            xmlElement(
              "BuiltinDevice",
              {
                deviceRole: "audioFX",
                deviceName: fx.type || "audioFx",
                deviceVendor: "ShadowClaw",
                loaded: "true",
                id: nextId(),
              },
              [
                xmlElement("State", { path: fxPresetPath, external: "false" }),
                xmlElement("Enabled", { value: "true", id: nextId() }),
              ],
            ),
          );
        }
      }
    }

    if (deviceElements.length > 0) {
      channelChildren.unshift(xmlElement("Devices", {}, deviceElements));
    }

    structureTracks.push(
      xmlElement(
        "Track",
        {
          contentType: isDrums ? "notes" : "notes",
          loaded: "true",
          id: tId,
          name: track.name || `Track ${idx + 1}`,
        },
        [
          xmlElement(
            "Channel",
            {
              audioChannels: "2",
              destination: masterChannelId,
              role: "regular",
              solo: String(Boolean(track.solo)),
              id: chId,
            },
            channelChildren,
          ),
        ],
      ),
    );
  });

  // Master Track in Structure
  const masterTrackId = nextId();
  const masterVol =
    project.master?.volume !== undefined ? project.master.volume : 0.8;
  structureTracks.push(
    xmlElement(
      "Track",
      {
        contentType: "audio notes",
        loaded: "true",
        id: masterTrackId,
        name: "Master",
      },
      [
        xmlElement(
          "Channel",
          {
            audioChannels: "2",
            role: "master",
            solo: "false",
            id: masterChannelId,
          },
          [
            xmlElement("Mute", { value: "false", id: nextId(), name: "Mute" }),
            xmlElement("Pan", {
              min: "0.000000",
              max: "1.000000",
              unit: "normalized",
              value: "0.500000",
              id: nextId(),
              name: "Pan",
            }),
            xmlElement("Volume", {
              min: "0.000000",
              max: "2.000000",
              unit: "linear",
              value: masterVol.toFixed(6),
              id: nextId(),
              name: "Volume",
            }),
          ],
        ),
      ],
    ),
  );

  // 3. Build Arrangement Lanes & Note Clips
  const arrangementLanes = [];

  tracks.forEach((track, idx) => {
    const ids = trackIdMap.get(track.id || `trk_${idx}`);
    if (!ids) return;

    const resolvedNotes = resolveTrackNotes(project, track, {
      loops: options.loops || 1,
      bakeMidiFx: options.bakeMidiFx !== false,
      bakeSwing: options.bakeSwing !== false,
    });

    const noteElements = resolvedNotes.map((n) => {
      // Convert PPQN to beats
      const timeBeats = n.position / (PPQN.Quarter || 960);
      const durBeats = n.duration / (PPQN.Quarter || 960);
      const velNorm = n.velocity > 1 ? n.velocity / 127 : n.velocity || 0.8;
      return xmlElement("Note", {
        time: timeBeats.toFixed(6),
        duration: durBeats.toFixed(6),
        channel: "0",
        key: String(Math.round(n.pitch)),
        vel: velNorm.toFixed(6),
        rel: "0.787402",
      });
    });

    const clipId = nextId();
    const clipElem = xmlElement(
      "Clip",
      {
        time: "0.0",
        duration: totalBeats.toFixed(1),
        playStart: "0.0",
        loopStart: "0.0",
        loopDuration: totalBeats.toFixed(1),
        id: clipId,
      },
      [xmlElement("Notes", { id: nextId() }, noteElements)],
    );

    arrangementLanes.push(
      xmlElement("Lanes", { track: ids.trackId, id: nextId() }, [
        xmlElement("Clips", { id: nextId() }, [clipElem]),
      ]),
    );

    // Timeline Audio Clips (e.g. Vocal stems, samples)
    if (Array.isArray(track.audioClips) && track.audioClips.length > 0) {
      const audioClipElems = track.audioClips.map((ac) => {
        const audioClipId = nextId();
        return xmlElement(
          "Clip",
          {
            time: String(ac.time || 0.0),
            duration: String(ac.duration || totalBeats),
            contentTimeUnit: "beats",
            name: ac.name || "Audio Clip",
            id: audioClipId,
          },
          [
            xmlElement("Audio", {
              sample: ac.sample || "",
              duration: String(ac.duration || totalBeats),
              channels: "2",
              id: nextId(),
            }),
          ],
        );
      });
      arrangementLanes.push(
        xmlElement("Lanes", { track: ids.trackId, id: nextId() }, [
          xmlElement("Clips", { id: nextId() }, audioClipElems),
        ]),
      );
    }

    // Continuous Parameter Automation Lanes (Points)
    if (track.automation && typeof track.automation === "object") {
      for (const [paramName, points] of Object.entries(track.automation)) {
        if (!Array.isArray(points) || points.length === 0) continue;
        const pointElements = points.map((pt) =>
          xmlElement("RealPoint", {
            time: Number(pt.time || 0).toFixed(6),
            value: Number(pt.value || 0).toFixed(6),
            id: nextId(),
          }),
        );
        arrangementLanes.push(
          xmlElement("Lanes", { track: ids.trackId, id: nextId() }, [
            xmlElement(
              "Points",
              {
                target: paramName,
                unit: paramName === "cutoff" ? "hertz" : "linear",
                id: nextId(),
              },
              pointElements,
            ),
          ]),
        );
      }
    }
  });

  // Master lane
  arrangementLanes.push(
    xmlElement("Lanes", { track: masterTrackId, id: nextId() }, [
      xmlElement("Clips", { id: nextId() }, []),
    ]),
  );

  // 4. Assemble root Project Document
  const projectDoc = serializeXmlDocument(
    xmlElement("Project", { version: "1.0" }, [
      xmlElement("Application", { name: "ShadowClaw DAW", version: "1.0.0" }),
      xmlElement("Transport", {}, [
        xmlElement("Tempo", {
          min: "20.000000",
          max: "666.000000",
          unit: "bpm",
          value: bpm.toFixed(6),
          id: tempoId,
          name: "Tempo",
        }),
        xmlElement("TimeSignature", {
          numerator: String(sigNum),
          denominator: String(sigDen),
          id: timeSigId,
        }),
      ]),
      xmlElement("Structure", {}, structureTracks),
      xmlElement("Arrangement", { id: nextId() }, [
        xmlElement(
          "Lanes",
          { timeUnit: "beats", id: nextId() },
          arrangementLanes,
        ),
      ]),
    ]),
  );

  // 5. Package into ZIP
  if (options.bouncedStems && typeof options.bouncedStems === "object") {
    for (const [stemId, stemData] of Object.entries(options.bouncedStems)) {
      extraFiles.push({
        name: `samples/${stemId}.wav`,
        data: stemData,
      });
    }
  }

  const zipEntries = [
    { name: "metadata.xml", data: encoder.encode(metaDoc) },
    { name: "project.xml", data: encoder.encode(projectDoc) },
    ...extraFiles,
  ];

  return encodeZip(zipEntries);
}

/**
 * Decodes a .dawproject ZIP archive into a ShadowClaw Project.
 * @param {ArrayBuffer | Uint8Array} input
 * @param {object} [options]
 * @returns {Promise<object>} ShadowClaw Project
 */
export function decodeDawProject(input, options = {}) {
  return (async () => {
    const entries = await decodeZip(input);
    const projEntry = entries.find((e) => e.name === "project.xml");
    if (!projEntry) {
      throw new Error("Invalid .dawproject: missing project.xml");
    }

    const presetsMap = new Map();
    for (const e of entries) {
      if (e.name.startsWith("presets/") && e.name.endsWith(".json")) {
        try {
          presetsMap.set(e.name, JSON.parse(new TextDecoder().decode(e.data)));
        } catch (_) {}
      }
    }

    const metaEntry = entries.find((e) => e.name === "metadata.xml");
    let title = "Imported DAWproject";
    if (metaEntry) {
      try {
        const metaXml = parseXml(new TextDecoder().decode(metaEntry.data));
        const titleNode = metaXml.children?.find((c) => c.tag === "Title");
        if (titleNode && titleNode.text) title = titleNode.text;
      } catch (_) {}
    }

    const xml = parseXml(new TextDecoder().decode(projEntry.data));
    if (xml.tag !== "Project") {
      throw new Error(`Invalid DAWproject root tag: ${xml.tag}`);
    }

    // 1. Read Transport
    let bpm = 120;
    let signature = [4, 4];

    const transport = xml.children?.find((c) => c.tag === "Transport");
    if (transport && transport.children) {
      const tempo = transport.children.find((c) => c.tag === "Tempo");
      if (tempo && tempo.attributes.value) {
        bpm = Math.round(parseFloat(tempo.attributes.value));
      }
      const timeSig = transport.children.find((c) => c.tag === "TimeSignature");
      if (timeSig) {
        const num = parseInt(timeSig.attributes.numerator || "4", 10);
        const den = parseInt(timeSig.attributes.denominator || "4", 10);
        signature = [num, den];
      }
    }

    // 2. Read Tracks from Structure
    const structure = xml.children?.find((c) => c.tag === "Structure");
    const tracksById = new Map();
    const tracksList = [];

    if (structure && structure.children) {
      for (const trackNode of structure.children.filter(
        (c) => c.tag === "Track",
      )) {
        const tId = trackNode.attributes.id;
        const name = trackNode.attributes.name || "Track";
        const channel = trackNode.children?.find((c) => c.tag === "Channel");
        const role = channel?.attributes.role || "regular";

        if (role === "master") continue; // Skip master track from track list

        let volume = 0.8;
        let pan = 0;
        let mute = false;
        let solo = channel?.attributes.solo === "true";
        let trackParams = undefined;
        const audioFx = [];
        const midiFx = [];

        if (channel && channel.children) {
          const volNode = channel.children.find((c) => c.tag === "Volume");
          if (volNode && volNode.attributes.value)
            volume = parseFloat(volNode.attributes.value);

          const panNode = channel.children.find((c) => c.tag === "Pan");
          if (panNode && panNode.attributes.value) {
            // Normalized 0..1 to -1..1
            pan = parseFloat(panNode.attributes.value) * 2 - 1;
          }

          const muteNode = channel.children.find((c) => c.tag === "Mute");
          if (muteNode && muteNode.attributes.value)
            mute = muteNode.attributes.value === "true";

          // Check for Devices / Equalizer / BuiltinDevice states
          const devicesNode = channel.children.find((c) => c.tag === "Devices");
          if (devicesNode && devicesNode.children) {
            for (const dev of devicesNode.children) {
              if (dev.tag === "Equalizer") {
                const bands = (dev.children || [])
                  .filter((b) => b.tag === "Band")
                  .map((b) => {
                    const freqNode = b.children?.find((c) => c.tag === "Freq");
                    const gainNode = b.children?.find((c) => c.tag === "Gain");
                    const qNode = b.children?.find((c) => c.tag === "Q");
                    return {
                      type: b.attributes.type || "bell",
                      order: parseInt(b.attributes.order || "2", 10),
                      freq: freqNode
                        ? parseFloat(freqNode.attributes.value || "1000")
                        : 1000,
                      gain: gainNode
                        ? parseFloat(gainNode.attributes.value || "0")
                        : 0,
                      q: qNode
                        ? parseFloat(qNode.attributes.value || "1.0")
                        : 1.0,
                    };
                  });

                audioFx.push({
                  id: dev.attributes.id || "eq",
                  type: "equalizer",
                  name: dev.attributes.deviceName || "Equalizer",
                  bands,
                });
              } else if (dev.tag === "BuiltinDevice" || dev.tag === "Device") {
                const stateNode = dev.children?.find((c) => c.tag === "State");
                const statePath = stateNode?.attributes?.path;
                const role = dev.attributes.deviceRole;
                if (statePath && presetsMap.has(statePath)) {
                  const data = presetsMap.get(statePath);
                  if (role === "instrument") {
                    trackParams = data;
                  } else if (role === "noteFX") {
                    midiFx.push(data);
                  } else if (role === "audioFX") {
                    audioFx.push(data);
                  }
                }
              }
            }
          }
        }

        const isDrums = /drum|percussion|beat/i.test(name);
        const trackObj = {
          id: tId,
          name,
          type: isDrums ? "drums" : "synth",
          kind: isDrums ? "drums" : "synth",
          volume,
          pan,
          mute,
          solo,
          params: trackParams,
          audioFx,
          midiFx,
          notes: [],
        };

        tracksById.set(tId, trackObj);
        tracksList.push(trackObj);
      }
    }

    // 3. Read Arrangement Clips & Notes
    const arrangement = xml.children?.find((c) => c.tag === "Arrangement");
    const rootLanes = arrangement?.children?.find((c) => c.tag === "Lanes");

    if (rootLanes && rootLanes.children) {
      for (const lane of rootLanes.children.filter((c) => c.tag === "Lanes")) {
        const trackId = lane.attributes.track;
        const trackObj = tracksById.get(trackId);
        if (!trackObj) continue;

        const pointsNode = lane.children?.find((c) => c.tag === "Points");
        if (pointsNode && pointsNode.children) {
          const targetParam = pointsNode.attributes.target || "volume";
          const pts = pointsNode.children
            .filter((c) => c.tag === "RealPoint" || c.tag === "Point")
            .map((p) => ({
              time: parseFloat(p.attributes.time || "0"),
              value: parseFloat(p.attributes.value || "0"),
            }))
            .sort((a, b) => a.time - b.time);

          if (!trackObj.automation) trackObj.automation = {};
          trackObj.automation[targetParam] = pts;
        }

        const clipsNode = lane.children?.find((c) => c.tag === "Clips");
        if (!clipsNode || !clipsNode.children) continue;

        for (const clip of clipsNode.children.filter((c) => c.tag === "Clip")) {
          const audioNode = clip.children?.find((c) => c.tag === "Audio");
          if (audioNode) {
            if (!trackObj.audioClips) trackObj.audioClips = [];
            trackObj.audioClips.push({
              time: parseFloat(clip.attributes.time || "0"),
              duration: parseFloat(
                clip.attributes.duration ||
                  audioNode.attributes.duration ||
                  "4",
              ),
              sample: audioNode.attributes.sample || "",
              name: clip.attributes.name || "Audio Clip",
            });
          }

          const clipTimeBeats = parseFloat(clip.attributes.time || "0");
          const notesNode = clip.children?.find((c) => c.tag === "Notes");
          if (!notesNode || !notesNode.children) continue;

          for (const noteNode of notesNode.children.filter(
            (c) => c.tag === "Note",
          )) {
            const noteTimeBeats = parseFloat(noteNode.attributes.time || "0");
            const noteDurBeats = parseFloat(
              noteNode.attributes.duration || "0.25",
            );
            const pitch = parseInt(noteNode.attributes.key || "60", 10);
            const vel = parseFloat(noteNode.attributes.vel || "0.8");

            const absTimeBeats = clipTimeBeats + noteTimeBeats;
            const positionPpqn = Math.round(
              absTimeBeats * (PPQN.Quarter || 960),
            );
            const durationPpqn = Math.max(
              60,
              Math.round(noteDurBeats * (PPQN.Quarter || 960)),
            );
            const velocity = Math.min(
              127,
              Math.max(1, Math.round(vel > 1 ? vel : vel * 127)),
            );

            trackObj.notes.push({
              position: positionPpqn,
              duration: durationPpqn,
              pitch,
              velocity,
            });
          }
        }
        trackObj.notes.sort((a, b) => a.position - b.position);
      }
    }

    return createProject({
      name: title,
      bpm,
      signature,
      tracks: tracksList,
    });
  })();
}
