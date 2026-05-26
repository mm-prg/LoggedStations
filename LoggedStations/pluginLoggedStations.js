/*
    LoggedStations
*/

"use strict";

(() => {
  // ==============================
  // GLOBAL VARIABLES
  // ==============================
  const pluginName = "LoggedStations";
  const pluginVersion = "0.0.3d";
  let notesMap = JSON.parse(localStorage.getItem("LoggedStationsMap") || localStorage.getItem("BandscanLogMap") || "{}");
  let freq = null;
  let pluginSettings = {
    startupBehavior: "server",
    remoteUrl: "",
    fmlistOmid: "",
    showToAllUsers: true
  };
  let isServerImport = false;

  // ==============================
  // INITIALIZATION
  // ==============================
  document.addEventListener("DOMContentLoaded", async () => {
    getFreq();
    drawIcon();
    initMainPanel();

    // Forza il caricamento iniziale dei dati se la frequenza è già presente nel DOM
    const targetNode = document.getElementById("data-frequency");
    if (targetNode && window.location.pathname !== "/setup") {
        const initialFreq = Number(typeof data !== 'undefined' ? data.freq : 0) || Number(targetNode.textContent);
        if (initialFreq && !isNaN(initialFreq)) {
            freq = initialFreq;
            updateNotes(freq);
        }
    }

    // Carica le impostazioni dal server all'avvio
    try {
        const response = await fetch('/plugins/LoggedStations/settings');
        if (response.ok) {
            const remoteSettings = await response.json();
            pluginSettings = { ...pluginSettings, ...remoteSettings };
            // Sincronizza localStorage per fallback o compatibilità
            localStorage.setItem("LoggedStationsStartupBehavior", pluginSettings.startupBehavior);
            localStorage.setItem("LoggedStationsRemoteUrl", pluginSettings.remoteUrl);
            localStorage.setItem("LoggedStationsOmid", pluginSettings.fmlistOmid || "");
            localStorage.setItem("LoggedStationsShowToAll", pluginSettings.showToAllUsers);
        }
    } catch (e) {
        console.warn(`[${pluginName}] Could not load settings from server, using defaults.`);
        pluginSettings.startupBehavior = localStorage.getItem("LoggedStationsStartupBehavior") || pluginSettings.startupBehavior;
        pluginSettings.remoteUrl = localStorage.getItem("LoggedStationsRemoteUrl") || pluginSettings.remoteUrl;
    }

    if (pluginSettings.startupBehavior === "server") {
        checkServerCSVFiles();
    } else if (pluginSettings.startupBehavior === "remote") {
        if (pluginSettings.remoteUrl) {
            importFromGitHub(pluginSettings.remoteUrl, true);
        }
    }

  });

  // ==============================
  // UPDATE STATION ICON & TOOLTIP
  // ==============================
  function performFmlistLog(btn, freq, pi, ps, sid, dist, itu) {
    const logMsg = `LoggedStations: ${ps || 'Station'} [${itu || ''}], PI: ${pi || '?'}, Dist: ${dist}km`;
    
    if (!confirm(`Confirm sending the log to FMLIST?\n\nMessage: "${logMsg}"`)) {
        return;
    }

    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    fetch('/plugins/LoggedStations/fmlistLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            freq: freq,
            pi: pi,
            ps: ps,
            stationid: sid,
            distance: dist,
            itu: itu
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.ok) sendToast('success', pluginName, "Log sent to FMLIST successfully!");
        else sendToast('error', pluginName, "Error during submission: " + (result.error || "Unknown"));
    })
    .catch(err => {
        sendToast('error', pluginName, "Network error: " + err.message);
    })
    .finally(() => {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
    });
  }

  function extractMetadata(record) {
    const piMatch = record.match(/\bPI[:=\s]*([0-9A-F]{4})\b/i);
    const ituMatch = record.match(/\s–\s([A-Z]{1,3})\s–\s/);
    const qrbMatch = record.match(/(\d+)\s*km/);
    const qtfMatch = record.match(/(\d+)\s*°/);
    const idMatch = record.match(/ID=(\d+)/i);
    const nameMatch = record.match(/(?:[\d\.]+\s)?([^–\(]+)/);

    return {
      pi: piMatch ? piMatch[1].toUpperCase() : "",
      itu: ituMatch ? ituMatch[1] : "",
      qrb: qrbMatch ? qrbMatch[1] : "",
      qtf: qtfMatch ? qtfMatch[1] : "",
      sid: idMatch ? idMatch[1] : "",
      name: nameMatch ? nameMatch[1].trim() : "Station"
    };
  }

  function initMainPanel() {
    const wrapper = document.getElementById("wrapper");
    if (!wrapper) return;

    const mainPanel = document.createElement("div");
    mainPanel.id = "logged-stations-main-panel";
    mainPanel.style.margin = "10px 0";
    mainPanel.style.padding = "10px";
    mainPanel.style.boxSizing = "border-box";
    mainPanel.style.background = "var(--bg-color-2, #2a2a2a)";
    mainPanel.style.borderRadius = "4px";
    mainPanel.style.borderLeft = "3px solid var(--color-5)";
    mainPanel.style.display = "block";
    mainPanel.style.fontSize = "13px";
    mainPanel.style.lineHeight = "1.4";
    mainPanel.style.color = "#eee";
    mainPanel.style.minHeight = "175px"; // Garantisce spazio per header + circa 5-6 stazioni
    // Appendo il pannello direttamente al wrapper affinché ne erediti i vincoli
    wrapper.appendChild(mainPanel);
  }

  function updateNotes(f) {
    const freqContainer = document.getElementById("freq-container");
    if (!freqContainer) return;

    // Controllo visibilità: se limitato agli admin, nascondi tutto per gli utenti comuni
    const isUserAdmin = typeof isAdmin !== 'undefined' && isAdmin;
    if (!pluginSettings.showToAllUsers && !isUserAdmin) {
        const mainPanel = document.getElementById("logged-stations-main-panel");
        if (mainPanel) mainPanel.style.display = "none";
        const pluginBox = document.getElementById("logged-stations-plugin-box");
        if (pluginBox) pluginBox.style.display = "none";
        return;
    }

    // Search for stations on the current frequency and nearby ones
    // FM: +-50kHz, MW/LW: +-5kHz
    const isFM = f > 50;
    const range = isFM ? 0.05 : 0.005; // 50 kHz for FM, 5 kHz for others
    const nearbyFreqKeys = Object.keys(notesMap).filter((key) => {
      return Math.abs(parseFloat(key) - f) <= range + 0.0001;
    });

    let stationData = [];
    if (nearbyFreqKeys.length > 0) {
      nearbyFreqKeys.sort((a, b) => parseFloat(a) - parseFloat(b));
      const rawRecords = nearbyFreqKeys.flatMap((freqKey) => {
          const records = Array.isArray(notesMap[freqKey]) ? notesMap[freqKey] : [notesMap[freqKey]];
          return records.filter(Boolean).map(r => ({ freq: freqKey, record: r }));
      });

      // Miglioramento come da TODO: Sposta gradi e direzione davanti e ordina alfabeticamente
      stationData = rawRecords.map(item => {
        let note = item.record;
        const itemFreqNum = parseFloat(item.freq);

        // Rimuove la frequenza dall'inizio della nota solo se coincide con quella sintonizzata (f)
        if (Math.abs(itemFreqNum - f) < 0.001) {
            const fRaw = item.freq.toString();
            const fFixed = itemFreqNum.toFixed(3);
            if (note.startsWith(fRaw + " ")) note = note.substring(fRaw.length + 1);
            else if (note.startsWith(fFixed + " ")) note = note.substring(fFixed.length + 1);
            else if (note.startsWith(fRaw)) note = note.substring(fRaw.length);
            else if (note.startsWith(fFixed)) note = note.substring(fFixed.length);
        }
        note = note.trim();
        // Usa lo spazio non breakabile (\u00A0) per evitare che il browser tagli gli spazi iniziali nel tooltip
        const NBSP = "\u00A0";

        // Verifica distanza >= 200km per aggiungere asterisco (DX)
        const qrbMatch = note.match(/(\d+)\s*km/);
        const prefix = (qrbMatch && parseInt(qrbMatch[1], 10) >= 200) ? "*" + NBSP : NBSP + NBSP;

        let formatted = "";
        // Cerca gradi e direzione separatamente per gestire il padding, ad esempio "323° (NW ↖)"
        const fullMatch = note.match(/(\d+)°\s*\(([NSEW]{1,2})\s+([^\)]+)\)/);
        if (fullMatch) {
          const deg = fullMatch[1].padStart(3, "0");
          const dir = fullMatch[2].padEnd(2, NBSP);
          const arrow = fullMatch[3];
          const tag = `${deg}° (${dir} ${arrow})`;
          // Rimuove gradi e direzione dalla posizione originale e li mette all'inizio
          let restOfNote = note.replace(fullMatch[0], "").replace(/\s{2,}/g, " ").trim();
          formatted = `${tag} ${prefix}${restOfNote}`;
        } else {
          // Fallback: se ci sono solo i gradi o solo la direzione
          const dirMatch = note.match(/\(([NSEW]{1,2})\s+([^\)]+)\)/);
          if (dirMatch) {
            const dir = dirMatch[1].padEnd(2, NBSP);
            const arrow = dirMatch[2];
            let restOfNote = note.replace(dirMatch[0], "").replace(/\s{2,}/g, " ").trim();
            // Padding frontale di 5 spazi per allinearsi ai record con gradi (es. "323° ")
            formatted = `${NBSP.repeat(5)}(${dir} ${arrow}) ${prefix}${restOfNote}`;
          } else {
            formatted = `${prefix}${note}`;
          }
        }
        return { ...item, formatted: formatted };
      });
      stationData.sort((a, b) => a.formatted.localeCompare(b.formatted));
    }

    // Update the element on the main page
    const mainPanel = document.getElementById("logged-stations-main-panel");
    const qthLat = localStorage.getItem("qthLatitude") || "";
    const qthLon = localStorage.getItem("qthLongitude") || "";

    if (mainPanel) {
      if (f !== null && !isNaN(f)) {
        const isFMCurrent = f > 50;
        const isSWCurrent = f >= 2.3 && f < 50;
        const isLWMWCurrent = f < 2.3;

        const toolbarBtnStyle = "padding:1px 5px; font-size:11px; margin:0; line-height:1; width:auto; text-align:center; height:26px; cursor:pointer;";
        let toolbarBtns = [];
        if (isFMCurrent) {
            toolbarBtns.push(`<a href="https://www.fmlist.org/fm_logmap.php?datum=0&hours=43200&band=ALL&target=ALL&rxin=Eur" target="_blank"><button style="${toolbarBtnStyle}" title="FM Visual Logbook">V-Log</button></a>`);
            toolbarBtns.push(`<a href="https://www.fmlist.org/ul_frameset.php?" target="_blank"><button style="${toolbarBtnStyle}" title="fmlist.org">fmlist</button></a>`);
            toolbarBtns.push(`<a href="https://highpoint.fmdx.org/webtools/sporadic-e-monitor.html" target="_blank"><button style="${toolbarBtnStyle}" title="Es Monitor">Es Mon</button></a>`);
            toolbarBtns.push(`<a href="https://www.dxinfocentre.com/tropo_eur.html" target="_blank"><button style="${toolbarBtnStyle}" title="Tropo Hepburn">Hepburn</button></a>`);
            toolbarBtns.push(`<a href="https://tropo.f5len.org/forecasts-for-europe/" target="_blank"><button style="${toolbarBtnStyle}" title="Tropo f5len">f5len</button></a>`);
            toolbarBtns.push(`<a href="https://dxrobot.gooddx.net/" target="_blank"><button style="${toolbarBtnStyle}" title="DX Robot">Robot</button></a>`);
            toolbarBtns.push(`<a href="https://www.dxmaps.com/spots/mapg.php?Lan=E" target="_blank"><button style="${toolbarBtnStyle}" title="DXMaps">Maps</button></a>`);
        } else if (isSWCurrent) {
            toolbarBtns.push(`<a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank"><button style="${toolbarBtnStyle}" title="SW Visual Logbook">SW-Log</button></a>`);
        } else if (isLWMWCurrent) {
            toolbarBtns.push(`<a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank"><button style="${toolbarBtnStyle}" title="MW Visual Logbook">MW-Log</button></a>`);
        }
        const toolbarHtml = toolbarBtns.length > 0 ? `<div style="display:flex; gap:2px; flex-shrink:0;">${toolbarBtns.join('')}</div>` : '';

        const header = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
                <div style="display:flex; align-items:center; font-weight: bold; font-size:14px; color: var(--color-5); white-space:nowrap; position:relative;">
                    <i class="fa-solid fa-bars" id="ls-menu-btn" style="cursor:pointer; margin-right:4px; padding: 2px 5px;" title="Data Import/Export"></i>
                    <div id="ls-dropdown-menu" style="display:none; position:absolute; top:22px; left:0; background: #2a2a2a; border:1px solid #555; border-radius:4px; z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.5); min-width:170px; padding:4px 0;">
                        <div class="ls-dropdown-item" data-action="import-csv" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">⬆ Import CSV</div>
                        <div class="ls-dropdown-item" data-action="import-remote" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">🌐 Import from GitHub</div>
                        <div class="ls-dropdown-item" data-action="export-json" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">⬇ Export JSON</div>
                        <div class="ls-dropdown-item" data-action="info" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px;">ℹ️ Info</div>
                    </div>

                    <i class="fa-solid fa-gear" id="ls-settings-btn" style="cursor:pointer; margin-right:8px; padding: 2px 5px;" title="Plugin Settings"></i>
                    <div id="ls-settings-menu" style="display:none; position:absolute; top:22px; left:25px; background: #2a2a2a; border:1px solid #555; border-radius:4px; z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.5); min-width:170px; padding:4px 0;">
                        <div class="ls-dropdown-item" data-action="show-data" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">📊 Show All Data</div>
                        <div class="ls-dropdown-item" data-action="startup-settings" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px;">⚙️ Startup Settings</div>
                    </div>

                    ${pluginName} (v${pluginVersion}) <span style="color:#888; margin-left:8px;">${f.toFixed(3)} MHz</span>
                </div>
                ${toolbarHtml}
            </div>`;

        let list = "";
        if (stationData.length > 0) {
            list = stationData.map((item, idx) => {
            const cleanNote = item.formatted.replace(/\u00A0/g, ' ');
            const meta = extractMetadata(item.record);
            const freqNum = parseFloat(item.freq);
            const isFM = freqNum > 50;
            const isSW = freqNum >= 2.3 && freqNum < 50;
            const isLWMW = freqNum < 2.3;
            
            const dist = parseInt(meta.qrb, 10);
            const isDX = !isNaN(dist) && dist >= 200;


            let displayNote = cleanNote;
            // Highlight station name in bold
            if (meta.name && meta.name !== "Station") {
                const nameIndex = cleanNote.indexOf(meta.name);
                if (nameIndex !== -1) {
                    displayNote = cleanNote.substring(0, nameIndex) + 
                                  `<strong>${meta.name}</strong>` + 
                                  cleanNote.substring(nameIndex + meta.name.length);
                }
            }

            const btnStyle = "padding:1px 0; font-size:14px; margin:0; line-height:1; width:30px; text-align:center; height:26px; cursor:pointer;";
            const actionBtns = [];

            if (isFM) {
                actionBtns.push(`<a href="https://maps.fmdx.org/#qth=${qthLat},${qthLon}&freq=${item.freq}&findPi=${meta.pi}" target="_blank"><button style="${btnStyle}" title="FMDX PI"><i class="fa-solid fa-fingerprint"></i></button></a>`);
                actionBtns.push(`<a href="https://maps.fmdx.org/#lat=${qthLat}&lon=${qthLon}&freq=${item.freq}&r=300" target="_blank"><button style="${btnStyle}" title="FMDX Freq"><i class="fa-solid fa-map"></i></button></a>`);
                actionBtns.push(`<a href="https://fmscan.org/main.php?f=${item.freq}&maptype=2&m=m&area=300" target="_blank"><button style="${btnStyle}" title="FMScan"><i class="fa-solid fa-tower-broadcast"></i></button></a>`);
                actionBtns.push(`<a href="https://fmstream.org/?s=${encodeURIComponent(meta.name)}" target="_blank"><button style="${btnStyle}" title="FMStream"><i class="fa-solid fa-play"></i></button></a>`);
                actionBtns.push(`<button class="mini-btn log-action" data-idx="${idx}" style="${btnStyle}" title="Log FMLIST"><i class="fa-solid fa-flag"></i></button>`);
                if (meta.pi) {
                    actionBtns.push(`<button class="mini-btn af-action" data-idx="${idx}" style="${btnStyle}" title="Alternative Frequencies">AF</button>`);
                }
            } else if (isLWMW) {
                actionBtns.push(`<a href="https://www.mwlist.org/mwlist_quick_and_easy.php?area=1&kHz=${freqNum * 1000}" target="_blank"><button style="${btnStyle}" title="MWList Search"><i class="fa-solid fa-magnifying-glass"></i></button></a>`);
                actionBtns.push(`<a href="https://www.mwlist.org/" target="_blank"><button style="${btnStyle}" title="MWList Homepage"><i class="fa-solid fa-house"></i></button></a>`);
            } else if (isSW) {
                actionBtns.push(`<a href="https://www.short-wave.info/index.php?freq=${freqNum * 1000}" target="_blank"><button style="${btnStyle}" title="short-wave.info"><i class="fa-solid fa-info"></i></button></a>`);
            }

            const buttonsHtml = actionBtns.length > 0 
                ? `<div style="display:flex; gap:2px; flex-shrink:0;">${actionBtns.join('')}</div>` 
                : '';

            return `
            <div class="station-row" style="display:flex; align-items:center; gap:8px; margin-bottom: 4px; padding-bottom: 2px; border-bottom: 1px dotted #444; ${isDX ? 'background: rgba(255, 215, 0, 0.05);' : ''}">
                <div style="font-size:12px; cursor:default; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-grow:1; ${isDX ? 'color: #ffd700; font-weight: bold;' : ''}" title="${cleanNote}">${displayNote}</div>
                ${buttonsHtml}
            </div>`;
        });
        list = `<div id="ls-stations-list" style="max-height: 250px; overflow-y: auto; padding-right: 4px;">${list.join('')}</div>`;
        } else {
            list = `<div style="padding:10px; color:#888; text-align:center; font-style:italic;">No logged stations for this frequency.</div>`;
        }

        mainPanel.innerHTML = header + list;

        // Attach events
        const menuBtn = mainPanel.querySelector('#ls-menu-btn');
        const dropdown = mainPanel.querySelector('#ls-dropdown-menu');
        const settingsBtn = mainPanel.querySelector('#ls-settings-btn');
        const settingsMenu = mainPanel.querySelector('#ls-settings-menu');

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                const closeMenu = () => { dropdown.style.display = 'none'; document.removeEventListener('click', closeMenu); };
                document.addEventListener('click', closeMenu);
            }
        };

        settingsBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = settingsMenu.style.display === 'block';
            settingsMenu.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                const closeSettings = () => { settingsMenu.style.display = 'none'; document.removeEventListener('click', closeSettings); };
                document.addEventListener('click', closeSettings);
            }
        };

        mainPanel.querySelectorAll('.ls-dropdown-item').forEach(item => {
            item.onmouseover = () => item.style.backgroundColor = '#444';
            item.onmouseout = () => item.style.backgroundColor = 'transparent';
            item.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                settingsMenu.style.display = 'none';
                const action = item.dataset.action;
                if (action === 'import-csv') { openManager(); setTimeout(() => document.getElementById('importCsvBtn')?.click(), 100); }
                else if (action === 'import-remote') { importFromGitHub(); }
                else if (action === 'export-json') { exportDatabaseJson(); } 
                else if (action === 'show-data') { openManager(); setTimeout(() => document.getElementById('showTableBtn')?.click(), 100); }
                else if (action === 'startup-settings') { showStartupSettings(); }
                else if (action === 'info') { showUploadedFileInfo(); }
            };
        });

        if (stationData.length > 0) {
        mainPanel.querySelectorAll('.log-action').forEach(btn => {
            btn.onclick = () => {
                const item = stationData[btn.dataset.idx];
                const meta = extractMetadata(item.record);
                performFmlistLog(btn, item.freq, meta.pi, meta.name, meta.sid, meta.qrb, meta.itu);
            };
        });
        mainPanel.querySelectorAll('.af-action').forEach(btn => {
            btn.onclick = () => {
                const item = stationData[btn.dataset.idx];
                const meta = extractMetadata(item.record);
                showOtherFrequencies(meta.pi, item.freq);
            };
        });
        }
      } else {
        mainPanel.style.display = "none";
      }
    }

    const rawNotes = stationData.map(d => d.formatted);

    // create a dedicated container
    // where the icon will be placed
    let pluginBox = document.getElementById("logged-stations-plugin-box");
    if (!pluginBox) {
      pluginBox = document.createElement("div");
      pluginBox.id = "logged-stations-plugin-box";
      pluginBox.style.position = "absolute";
      pluginBox.style.top = "5px";
      pluginBox.style.left = "10px";
      pluginBox.style.zIndex = "20";
      pluginBox.style.display = "flex";
      pluginBox.style.alignItems = "center";
      pluginBox.style.gap = "6px";

      freqContainer.appendChild(pluginBox);
    }

    // clear the container and thus remove the previous icon
    pluginBox.innerHTML = "";

    // Create notes icon
    const icon = document.createElement("i");

    // icon position and style (previously was 18px)
    icon.style.fontSize = "22px";
    icon.style.cursor = "pointer";
    icon.style.color = "var(--color-5)";
    icon.style.lineHeight = "1";

    const togglePanel = () => {
      if (mainPanel) {
        mainPanel.style.display = mainPanel.style.display === "none" ? "block" : "none";
      }
    };

    // Check if there are stations for that frequency
    if (rawNotes && rawNotes.length > 0) {
      // ✅ NOTES FOUND
      icon.className = "fa-solid fa-radio";
      icon.style.opacity = "0.8";
      icon.title = Array.isArray(rawNotes) ? rawNotes.join("\n") : rawNotes;
      icon.onclick = togglePanel;
    } else {
      // ❌ NO NOTES
      icon.className = "fa-solid fa-circle";
      icon.style.opacity = "0.5";
      icon.title = "No data for this frequency";
      icon.onclick = togglePanel;
    }

    // aggiunge l'icona al contenitore
    pluginBox.appendChild(icon);
  }

  // ==============================
  // STATION MANAGER POPUP
  // ==============================
  function openManager() {
    // if the popup is already open, close it (allows closing by clicking the icon again)
    const existingPopup = document.getElementById("LoggedStationsPopup");
    if (existingPopup) {
      closePopup();
      return;
    }

    // total station count
    const totalRecords = Object.values(notesMap).reduce((sum, arr) => {
        const records = Array.isArray(arr) ? arr : [arr];
        return sum + records.length;
    }, 0);

    const popupToolbarStyle = "padding:4px 8px; width:auto; height:30px; font-size:12px; cursor:pointer;";

    const popupHTML = `
    <div style="padding:10px; position:relative;">

    <!-- CURRENT FREQUENCY -->
    <div id="currentFreqTable"
    style="margin-bottom:14px;"></div>

    <!-- LINKS TOOLBAR (compact, one line) -->
    <div style="
        display:flex;
        flex-wrap:nowrap;
        gap:6px;
        align-items:center;
        margin-bottom:12px;
        white-space:nowrap;
        overflow-x:auto;
    ">
        ${(freq !== null && freq >= 50) ? `
        <a href="https://www.fmlist.org/fm_logmap.php?datum=0&hours=43200&band=ALL&target=ALL&rxin=Eur" target="_blank">
            <button title="View FM logbook map on fmlist.org" style="${popupToolbarStyle}">V-Log</button>
        </a>
        <a href="https://www.fmlist.org/ul_frameset.php?" target="_blank">
            <button title="Open fmlist.org main page" style="${popupToolbarStyle}">fmlist</button>
        </a>
        <a href="https://www.fmlist.org/fi_bandscan.php" target="_blank">
            <button title="Open fmlist.org bandscan tool" style="${popupToolbarStyle}">Bandscan</button>
        </a>

        <a href="https://highpoint.fmdx.org/webtools/sporadic-e-monitor.html" target="_blank">
            <button title="Highpoint's Es Monitor" style="${popupToolbarStyle}">Es Mon</button>
        </a>

        <a href="https://www.dxinfocentre.com/tropo_eur.html" target="_blank">
            <button title="View William Hepburn's Tropospheric Ducting Forecast" style="${popupToolbarStyle}">Hepburn</button>
        </a>
        <a href="https://tropo.f5len.org/forecasts-for-europe/" target="_blank">
            <button title="View F5LEN Tropospheric Propagation Forecast" style="${popupToolbarStyle}">f5len</button>
        </a>

        <a href="https://dxrobot.gooddx.net/" target="_blank">
            <button title="View DX Robot real-time spots" style="${popupToolbarStyle}">Robot</button>
        </a>
        <a href="https://www.dxmaps.com/spots/mapg.php?Lan=E" target="_blank">
            <button title="View DXMaps real-time propagation maps" style="${popupToolbarStyle}">Maps</button>
        </a>
        ` : ''}

        ${(freq !== null && freq < 50 && freq >= 2.3) ? `
        <a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank">
            <button title="View SW logbook map" style="${popupToolbarStyle}">SW-Log</button>
        </a>
        ` : ''}

        ${(freq !== null && freq < 50 && freq <= 2.3) ? `
        <a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank">
            <button title="View MW logbook map on mwlist.org" style="${popupToolbarStyle}">MW-Log</button>
        </a>
        ` : ''}

        
    </div>

    <h3>Database: ${Object.keys(notesMap).length} frequencies - ${totalRecords} stations</h3>

    <div id="uploadedFilesInfo"
        style="font-size:14px; color:#999; margin-bottom:8px;">
        (uploaded files: loading…)
    </div>

    <!-- ACTION TOOLBAR (one line, full text) -->
    <div style="
        display:flex;
        flex-wrap:nowrap;
        gap:6px;
        align-items:center;
        margin-bottom:8px;
        white-space:nowrap;
        overflow-x:auto;
    ">
        <button id="showTableBtn" title="Toggle visibility of the full database table">
            📊 Show all data
        </button>

        <button id="importCsvBtn" title="Import stations from a CSV file">
            ⬆ Import CSV
        </button>
        <input type="file" id="importCsvFile" accept=".csv" style="display:none;">

        <button id="importJsonBtn" title="Import a database from a JSON file">
            ⬆ Import JSON
        </button>
        <input type="file" id="importJsonFile" accept=".json" style="display:none;">

        <button id="exportJsonBtn" title="Export the current database to a JSON file">
            ⬇ Export JSON
        </button>

    </div>

    <div id="tableContainer" style="display:none;"></div>
    `;

    showPopup(popupHTML);

    // current frequency table
    const currentFreqBox = document.getElementById("currentFreqTable");

    if (freq && !isNaN(freq)) {
      renderTable(currentFreqBox, 5, freq);
    } else {
      currentFreqBox.innerHTML = "<i>No active frequency</i>";
    }

    // full table
    const tableContainer = document.getElementById("tableContainer");
    const showTableBtn = document.getElementById("showTableBtn");

    // populate uploaded files list

    (async () => {
      const info = document.getElementById("uploadedFilesInfo");
      if (!info) return;

      const serverFiles = await getServerFiles();
      const localStore = loadUploadedStore();
      const remoteStore = JSON.parse(localStorage.getItem("LoggedStationsRemoteFiles") || "{}");

      const names = new Set();
      serverFiles.forEach((f) => {
        if (f && f.name) names.add(f.name);
      });
      Object.keys(localStore).forEach((n) => names.add(n));
      Object.keys(remoteStore).forEach((n) => names.add(n));

      if (names.size === 0) {
        info.textContent = "(uploaded files: none)";
        return;
      }

      const displayNames = [];
      const tooltipLines = [];

      names.forEach((name) => {
        const serverObj = serverFiles.find((f) => f && f.name === name);
        const remoteObj = remoteStore[name];
        const localMtime = localStore[name] || null;
        const serverMtime =
          serverObj && serverObj.mtimeMs ? serverObj.mtimeMs : null;
        const mtime = serverMtime || localMtime || (remoteObj ? remoteObj.mtimeMs : null);
        
        let src = "local";
        if (serverObj && serverObj.uploaded) src = "server";
        else if (remoteObj) src = "remote";

        const date = mtime ? new Date(mtime).toLocaleDateString() : "unknown";

        displayNames.push(name);
        tooltipLines.push(`${name} — ${date} — ${src}`);
      });

      // testo visibile (solo nomi)
      info.textContent = `(${displayNames.join(", ")})`;

      // tooltip con dettagli completi
      info.title = tooltipLines.join("\n");
    })();

    // ✅ Mostra la tabella solo quando cliccato
    showTableBtn.onclick = () => {
      const isHidden = tableContainer.style.display === "none";

      if (isHidden) {
        // mostra tabella completa
        tableContainer.style.display = "block";
        renderTable(tableContainer);
        showTableBtn.textContent = "📉 Hide Excel Table";

        // nasconde la tabella della frequenza corrente
        if (currentFreqBox) {
          currentFreqBox.style.display = "none";
        }
      } else {
        // nasconde tabella completa
        tableContainer.style.display = "none";
        showTableBtn.textContent = "📊 Show all data";

        // ripristina la tabella della frequenza corrente
        if (currentFreqBox) {
          currentFreqBox.style.display = "";
        }
      }
    };

    // ✅ JSON Export
    document.getElementById("exportJsonBtn").onclick = () => {
      exportDatabaseJson();
    };

    // ✅ JSON Import
    document.getElementById("importJsonBtn").onclick = () => {
      document.getElementById("importJsonFile").click();
    };
    document.getElementById("importJsonFile").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          notesMap = JSON.parse(reader.result);
          saveNotes();
          openManager();
        } catch (err) {
          sendToast('error', pluginName, "Invalid JSON file");
        }
      };
      reader.readAsText(file);
    };

    // ✅ CSV Import
    document.getElementById("importCsvBtn").onclick = () => {
      document.getElementById("importCsvFile").click();
    };

    document.getElementById("importCsvFile").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const name = file.name;
      const mtime = file.lastModified || null;

      console.log(
        `[${pluginName}] Selected CSV file: ${name} (lastModified: ${mtime})`
      );

      // controlla store locale e server per evitare duplicati
      const serverFiles = await getServerFiles();
      const localUploaded = isAlreadyUploadedLocal(name, mtime);
      const serverUploaded = isAlreadyUploadedServer(serverFiles, name, mtime);
      if (localUploaded || serverUploaded) {
        console.log(
          `[${pluginName}] Skipped import for ${name} — already uploaded ${localUploaded ? "(local)" : ""}${serverUploaded ? "(server)" : ""} mtime:${mtime}`
        );
        sendToast('warning', pluginName, "This file has already been imported (same name and date)");
        return;
      }

      const reader = new FileReader();

      // legge come ArrayBuffer
      reader.onload = () => {
        const arrayBuffer = reader.result;
        let csvText;

        try {
          // prova a decodificare con windows-1252 (ANSI)
          const decoder = new TextDecoder("windows-1252");
          csvText = decoder.decode(arrayBuffer);
        } catch (err) {
          // se non supportato, prova UTF-8 come fallback
          csvText = new TextDecoder("utf-8").decode(arrayBuffer);
        }

        console.log(`[${pluginName}] Importing CSV file: ${name}`);
        importFromCSV(csvText);
        // segna come importato
        markFileUploaded(name, mtime);
      };

      reader.readAsArrayBuffer(file);
    };
  }

  // ==============================
  // HELPERS / TOAST NOTIFICATIONS
  // ==============================
  function sendToast(type, title, message, autoClose = 10000, closeOnClick = true) {
    if (typeof window.sendToast === "function") {
        window.sendToast(type, title, message, autoClose, closeOnClick);
    } else {
        // Fallback to alert for important messages
        if (type.includes('error') || type.includes('warning') || type.includes('success')) {
            alert(`[${title}] ${message}`);
        }
        console.log(`[${title}] ${message}`);
    }
  }

  function showOtherFrequencies(piCode, currentFreq) {
    if (!piCode) {
      sendToast('info', pluginName, "Nessun codice PI da cercare.");
      return;
    }

    const otherFreqResults = [];
    let mainStationName = '';

    // Iterate over all frequencies in the notesMap
    for (const freqKey in notesMap) {
      const records = Array.isArray(notesMap[freqKey]) ? notesMap[freqKey] : [notesMap[freqKey]];
      
      // Iterate over all records for that frequency
      for (const record of records) {
        if (!record) continue;
        const recordPiMatch = record.match(/\bPI[:=\s]*([0-9A-F]{4})\b/i);
        const recordPi = recordPiMatch ? recordPiMatch[1].toUpperCase() : "";

        if (recordPi === piCode) {
          // Find station name from any record with this PI
          if (!mainStationName) {
              const nameMatch = record.match(/^\s*\d+\.?\d*\s+([^–\(]+)/);
              mainStationName = nameMatch ? nameMatch[1].trim() : '';
          }
          // Add to results if it's not the current frequency
          if (parseFloat(freqKey) !== parseFloat(currentFreq)) {
            otherFreqResults.push({ freq: freqKey, record: record });
          }
        }
      }
    }

    let popupContent;
    if (otherFreqResults.length > 0) {
      otherFreqResults.sort((a,b) => parseFloat(a.freq) - parseFloat(b.freq));
      const listItems = otherFreqResults.map((r, index) => {
          const recordParts = r.record.split(' – ');
          const stationAndFreq = recordParts.shift() || ''; // e.g., "87.500 Radio Maria"
          const station = stationAndFreq.replace(/^\d+\.?\d*\s+/, '').trim();
          const details = recordParts.join(' – ');
          const isLast = index === otherFreqResults.length - 1;

          return `
            <li data-freq="${r.freq}" style="padding: 8px 0; cursor: pointer; ${!isLast ? 'border-bottom: 1px solid #444;' : ''}" title="Tune to ${r.freq} MHz">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-weight: bold; font-size: 1.1em;">${r.freq} MHz</span>
                    <span style="font-style: italic;">${station}</span>
                </div>
                <div style="font-size: 0.9em; color: #ccc;">
                    ${details}
                </div>
            </li>
          `;
      }).join('');

      popupContent = `
        <h3>Altre frequenze per ${mainStationName || 'stazione'} (PI: ${piCode})</h3>
        <ul style="list-style:none; padding:0; font-size: 14px; margin-top: 15px;">
          ${listItems}
        </ul>
      `;
    } else {
      popupContent = `<h3>Nessun'altra frequenza trovata per ${mainStationName || `il PI ${piCode}`}.</h3>`;
    }

    showSecondPopup(popupContent);
  }

  function exportDatabaseJson() {
    const blob = new Blob([JSON.stringify(notesMap, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "LoggedStations.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function showUploadedFileInfo() {
    const serverFiles = await getServerFiles();
    const localStore = loadUploadedStore();
    const remoteStore = JSON.parse(localStorage.getItem("LoggedStationsRemoteFiles") || "{}");

    const names = new Set();
    serverFiles.forEach((f) => { if (f && f.name) names.add(f.name); });
    Object.keys(localStore).forEach((n) => names.add(n));
    Object.keys(remoteStore).forEach((n) => names.add(n));

    const totalFreqs = Object.keys(notesMap).length;
    const totalRecords = Object.values(notesMap).reduce((sum, arr) => {
        const records = Array.isArray(arr) ? arr : [arr];
        return sum + records.length;
    }, 0);

    let html = `<h3>Database Statistics</h3>
                <div style="margin-bottom:15px; padding:10px; background:rgba(255,255,255,0.05); border-radius:4px; border-left:3px solid var(--color-5);">
                  <strong>Total Frequencies:</strong> ${totalFreqs}<br>
                  <strong>Total Stations:</strong> ${totalRecords}
                </div>
                <h3>Uploaded Files Details</h3>`;

    if (names.size === 0) {
      html += "<p style='margin-top:10px;'>No file uploaded in the local database or present on the server.</p>";
    } else {
      html += '<ul style="list-style:none; padding:0; font-size:13px; margin-top:15px; border-top:1px solid #444;">';
      names.forEach((name) => {
        const serverObj = serverFiles.find((f) => f && f.name === name);
        const localMtime = localStore[name] || null;
        const serverMtime = serverObj && serverObj.mtimeMs ? serverObj.mtimeMs : null;
        const remoteObj = remoteStore[name];
        const mtime = serverMtime || localMtime || (remoteObj ? remoteObj.mtimeMs : null);
        
        let src = "local";
        let displayPath = "Local upload";
        if (serverObj && serverObj.uploaded) {
            src = "server";
            displayPath = `/plugins/LoggedStations/files/${name}`;
        } else if (remoteObj) {
            src = "remote (GitHub)";
            displayPath = remoteObj.path || "GitHub Repository";
        }

        const date = mtime ? new Date(mtime).toLocaleString() : "unknown date";
        html += `<li style="padding: 10px 0; border-bottom: 1px solid #444;">
                  <div style="font-weight: bold; color: var(--color-5);">${name}</div>
                  <div style="font-size: 0.9em; color: #ccc; margin-top:4px;">
                    Data: ${date} <br>
                    Origin: ${src} <br>
                    Path: ${displayPath}
                  </div>
                </li>`;
      });
      html += "</ul>";
    }
    showSecondPopup(html);
  }

  // ==============================
  // Funzione per generare la tabella
  // ==============================

  function renderTable(container, rowsPerPage = 50, onlyFreq = null) {
    let page = 0;
    const singleFreqMode = onlyFreq !== null;

    // get all frequencies sorted numerically, apply filter if in singleFreqMode
    function getFreqs() {
      let freqs = Object.keys(notesMap).sort(
        (a, b) => parseFloat(a) - parseFloat(b)
      );

      // if in singleFreqMode, filter for frequencies near onlyFreq (allowing 50 kHz tolerance for FM and 5 kHz for MW/LW)
      if (singleFreqMode) {
        // FM: +-50kHz, MW/LW: +-5kHz
        const isFM = onlyFreq > 50;
        const range = isFM ? 0.05 : 0.005; // 50 kHz for FM, 5 kHz for others
        let matched = freqs.filter((f) => {
          return Math.abs(parseFloat(f) - onlyFreq) <= range + 0.0001;
        });
        if (matched.length === 0) matched = [onlyFreq.toString()];
        return matched;
      }
      return freqs;
    }

    // normalize records for a frequency: flatten if array, transform string to array, return default if no data
    function normalizeRecords(freq) {
      if (!notesMap[freq] || notesMap[freq].length === 0) {
        return ["No data for this frequency"];
      }
      const raw = Array.isArray(notesMap[freq])
        ? notesMap[freq]
        : [notesMap[freq]];
      const records = raw.flatMap((n) =>
        n
          .split("|")
          .map((r) => r.trim())
          .filter(Boolean)
      );
      return records.length ? records : ["No data for this frequency"];
    }

    // render the current page of the table, with actions and navigation buttons
    function renderPage() {
      const freqs = getFreqs();
      const totalPages = Math.max(1, Math.ceil(freqs.length / rowsPerPage));
      page = Math.min(Math.max(page, 0), totalPages - 1);

      const start = page * rowsPerPage;
      const end = start + rowsPerPage;
      const visibleFreqs = freqs.slice(start, end);

      const qthLat = localStorage.getItem("qthLatitude");
      const qthLon = localStorage.getItem("qthLongitude");

      let rowsHTML = "";
      visibleFreqs.forEach((freq) => {
        normalizeRecords(freq).forEach((record) => {
          const piMatch = record.match(/\bPI[:=\s]*([0-9A-F]{4})\b/i);
          const piCode = piMatch ? piMatch[1].toUpperCase() : "";
          const nameMatch = record.match(/^\s*\d+\.?\d*\s+([^–\(]+)/);
          const name = nameMatch ? nameMatch[1].trim() : record.split(" – ")[0].replace(/^\d+\.\d+\s+/, '').trim();

                // FMList Log Metadata extraction (ITU, QRB, QTF and Station ID if present)
                const ituMatch = record.match(/\s–\s([A-Z]{1,3})\s–\s/);
                const itu = ituMatch ? ituMatch[1] : "";
                const qrbMatch = record.match(/(\d+)\s*km/);
                const qrb = qrbMatch ? qrbMatch[1] : "";
                const qtfMatch = record.match(/(\d+)\s*°/);
                const qtf = qtfMatch ? qtfMatch[1] : "";
                const idMatch = record.match(/ID=(\d+)/i);
                const fmlistId = idMatch ? idMatch[1] : "";

          const freqNum = parseFloat(freq);
          const isFM = freqNum > 50;
          const isSW = freqNum >= 2.3 && freqNum < 50;
          const isLWMW = freqNum < 2.3;

          const mapsUrlPi = `https://maps.fmdx.org/#qth=${qthLat},${qthLon}&freq=${freq}&findPi=${piCode}`;
          const mapsUrlFreq = `https://maps.fmdx.org/#lat=${qthLat}&lon=${qthLon}&freq=${freq}&r=300`;
          const mapsUrlFmscan = `https://fmscan.org/main.php?f=${freq}&maptype=2&m=m&area=300`;
          const mapsUrlFmstream = `https://fmstream.org/?s=${name}`;
          
          const mapsUrlMwlist = `https://www.mwlist.org/mwlist_quick_and_easy.php?area=1&kHz=${freq * 1000}`;
          const mapsUrlMwlist2 = `https://www.mwlist.org/`;
          const mapsUrlSwinfo = `https://www.short-wave.info/index.php?freq=${freq * 1000}`;

          const tableBtnStyle = "padding:2px 0; font-size:15px; width:34px; height:28px; cursor:pointer;";
          rowsHTML += `<tr data-freq="${freq}" style="border-bottom:1px solid #ccc;">
                    <td ${singleFreqMode ? "" : 'contenteditable="true"'} class="freqCell">${freq}</td>
                    <td ${singleFreqMode ? "" : 'contenteditable="true"'} class="noteCell">${record}</td>

                    <td style="
                        text-align:center;
                        display:flex;
                        justify-content:center;
                        gap:6px;
                        flex-wrap:wrap;
                        min-width:200px;
                    ">
                        ${
                          isFM
                            ? `
                            <a href="${mapsUrlPi}" target="_blank"><button style="${tableBtnStyle}" title="Show station on maps.fmdx.org (PI)"><i class="fa-solid fa-fingerprint"></i></button></a>
                            <a href="${mapsUrlFreq}" target="_blank"><button style="${tableBtnStyle}" title="Show frequency on maps.fmdx.org"><i class="fa-solid fa-map"></i></button></a>
                            <a href="${mapsUrlFmscan}" target="_blank"><button style="${tableBtnStyle}" title="Show frequency on fmscan.org"><i class="fa-solid fa-tower-broadcast"></i></button></a>
                            <a href="${mapsUrlFmstream}" target="_blank"><button style="${tableBtnStyle}" title="Listen on fmstream.org"><i class="fa-solid fa-play"></i></button></a>
                            
                            <button class="fmlist-log-btn" data-freq="${freq}" data-pi="${piCode}" data-ps="${name}" data-sid="${fmlistId}" data-dist="${qrb}" data-itu="${itu}" title="Automated log on fmlist.org" style="${tableBtnStyle}"><i class="fa-solid fa-flag"></i></button>

                            ${piCode ? `<a href="#"><button class="pi-search-btn" data-pi="${piCode}" data-freq="${freq}" title="Search for Alternative Frequencies (AF)" style="${tableBtnStyle}">AF</button></a>` : ''}

                        `
                            : ""
                        }

                        ${
                          isLWMW
                            ? `
                            <a href="${mapsUrlMwlist}" target="_blank"><button style="${tableBtnStyle}" title="Show frequency on mwlist.org"><i class="fa-solid fa-magnifying-glass"></i></button></a>
                            <a href="${mapsUrlMwlist2}" target="_blank"><button style="${tableBtnStyle}" title="mwlist.org (homepage)"><i class="fa-solid fa-house"></i></button></a>

                        `
                            : ""
                        }

                        ${
                          isSW
                            ? `
                            <a href="${mapsUrlSwinfo}" target="_blank"><button style="${tableBtnStyle}" title="Show frequency on short-wave.info"><i class="fa-solid fa-info"></i></button></a>
                        `
                            : ""
                        }
                    </td>
                </tr>`;
        });
      });

      container.innerHTML = `
            ${
              !singleFreqMode
                ? `<input type="text" id="filterInput" placeholder="Filter by frequency or note..." title="Filter by frequency or note"
                style="width:100%; margin-bottom:8px; padding:5px; font-size:14px;">`
                : ""
            }
            <div style="max-height:60vh; overflow:auto; border:1px solid #555; border-radius:6px;">
                <table id="bandscanTable" style="width:100%; border-collapse:collapse; table-layout:fixed; font-size:14px;">
                    <thead style="background:#333; color:#fff; position:sticky; top:0; z-index:2;">
                        <tr>
                            <th data-col="freq" style="border:1px solid #555; padding:6px; cursor:pointer; width:10%;">Frequency ▲▼</th>
                            <th data-col="note" style="border:1px solid #555; padding:6px; cursor:pointer; width:60%;">Station ▲▼</th>
                            <th style="border:1px solid #555; padding:6px; width:30%;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHTML}</tbody>
                </table>
            </div>
            ${
              !singleFreqMode
                ? `
                <div style="position:sticky; bottom:0; background:#222; border-top:1px solid #555;
                    padding:6px; display:flex; justify-content:center; align-items:center; gap:12px; z-index:3;">
                    <button id="prevPageBtn" title="Previous page">⬅ Prev</button>
                    <span>Page ${page + 1} / ${totalPages}</span>
                    <button id="nextPageBtn" title="Next page">Next ➡</button>
                </div>
                <div style="margin-top:8px; text-align:center;">
                    <button id="addRowBtn" title="Add a new row manually">➕ Add Row</button>
                    <button id="saveTableBtn" title="Save changes to local storage">💾 Save Changes</button>
                </div>
            `
                : ""
            }
        `;

      attachActions();
    }

    function attachActions() {
      const tbody = container.querySelector("tbody");
      const filterInput = container.querySelector("#filterInput");

      if (filterInput) {
        filterInput.oninput = () => {
          const filter = filterInput.value.toLowerCase();
          tbody.querySelectorAll("tr").forEach((tr) => {
            const freq = tr
              .querySelector(".freqCell")
              .textContent.toLowerCase();
            const note = tr
              .querySelector(".noteCell")
              .textContent.toLowerCase();
            tr.style.display =
              freq.includes(filter) || note.includes(filter) ? "" : "none";
          });
        };
      }

      tbody.querySelectorAll(".pi-search-btn").forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pi = btn.dataset.pi;
            const currentFreq = btn.dataset.freq;
            showOtherFrequencies(pi, currentFreq);
        };
      });

      tbody.querySelectorAll(".fmlist-log-btn").forEach(btn => {
        btn.onclick = () => {
            performFmlistLog(btn, btn.dataset.freq, btn.dataset.pi, btn.dataset.ps, btn.dataset.sid, btn.dataset.dist, btn.dataset.itu);
        };
      });

      container.querySelectorAll("th[data-col]").forEach((th) => {
        let asc = true;
        th.onclick = () => {
          const col = th.dataset.col === "freq" ? ".freqCell" : ".noteCell";
          const rows = Array.from(tbody.querySelectorAll("tr"));
          rows.sort((a, b) => {
            const A = a.querySelector(col).textContent.trim();
            const B = b.querySelector(col).textContent.trim();
            return th.dataset.col === "freq"
              ? asc
                ? parseFloat(A) - parseFloat(B)
                : parseFloat(B) - parseFloat(A)
              : asc
                ? A.localeCompare(B)
                : B.localeCompare(A);
          });
          rows.forEach((r) => tbody.appendChild(r));
          asc = !asc;
        };
      });

      if (!singleFreqMode) {
        const prevBtn = container.querySelector("#prevPageBtn");
        const nextBtn = container.querySelector("#nextPageBtn");
        const freqs = getFreqs();

        prevBtn.onclick = () => {
          if (page > 0) {
            page--;
            renderPage();
          }
        };
        nextBtn.onclick = () => {
          if ((page + 1) * rowsPerPage < freqs.length) {
            page++;
            renderPage();
          }
        };

        container.querySelector("#addRowBtn").onclick = () => {
          const f = prompt("Frequency (MHz):");
          const n = prompt("Note:");
          if (!f || !n) return;
          if (!notesMap[f]) notesMap[f] = [];
          notesMap[f].push(n);
          renderPage();
        };

        container.querySelector("#saveTableBtn").onclick = () => {
          const newMap = {};
          tbody.querySelectorAll("tr").forEach((tr) => {
            const f = tr.querySelector(".freqCell").textContent.trim();
            const n = tr.querySelector(".noteCell").textContent.trim();
            if (!f || !n) return;
            if (!newMap[f]) newMap[f] = [];
            newMap[f].push(n);
          });
          notesMap = newMap;
          saveNotes();
          sendToast('success', pluginName, "Changes saved!");
        };
      }
    }

    renderPage();
  }

  // ==============================
  // TRANSFORM QTF TO DIRECTION
  // ==============================
  function qtfToDirectionArrow(deg) {
    if (isNaN(deg)) return { dir: "", arrow: "" };

    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
    const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖", "↑"];

    const idx = Math.round(deg / 45);
    return {
      dir: dirs[idx],
      arrow: arrows[idx],
    };
  }

  // ==============================
  // CSV IMPORT PARSER
  // ==============================
  // ==============================
  // Uploaded files tracking (localStorage)
  // ==============================
  // keeps track of already imported CSV files to avoid duplicates
  function loadUploadedStore() {
    try {
      return JSON.parse(
        localStorage.getItem("LoggedStationsUploadedFiles") || localStorage.getItem("BandscanLogUploadedFiles") || "{}"
      );
    } catch (e) {
      return {};
    }
  }

  // save the state of imported files
  function saveUploadedStore(store) {
    try {
      localStorage.setItem("LoggedStationsUploadedFiles", JSON.stringify(store));
    } catch (e) {
      console.error("Error saving uploaded store", e);
    }
  }

  // check if a file has already been imported locally
  function isAlreadyUploadedLocal(name, mtimeMs) {
    const store = loadUploadedStore();
    return store[name] && store[name] === mtimeMs;
  }

  // mark a file as imported
  async function markFileUploaded(name, mtimeMs) {
    const behavior = pluginSettings.startupBehavior;
    
    // save locally
    const store = loadUploadedStore();
    store[name] = mtimeMs;
    saveUploadedStore(store);

    console.log(
      `[${pluginName}] Marked local uploaded: ${name} (mtime:${mtimeMs})`
    );

    if (behavior !== "server") return;

    // notify server (best-effort)
    try {
      const res = await fetch(
        `/plugins/LoggedStations/files/${encodeURIComponent(name)}/markUploaded`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mtimeMs }),
        }
      );
      if (res.ok) {
        console.log(
          `[${pluginName}] Notified server about uploaded file: ${name}`
        );
      } else {
        console.warn(
          `[${pluginName}] Server responded with status ${res.status} when notifying uploaded file: ${name}`
        );
      }
    } catch (e) {
      console.warn("Could not notify server about uploaded file", e);
    }
  }

  // download a CSV file from the server and import it
  async function getServerFiles() {
    try {
      const behavior = pluginSettings.startupBehavior;
      if (behavior !== "server") return [];

      const res = await fetch("/plugins/LoggedStations/files");
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    } catch (e) {
      return [];
    }
  }

  // download and import a CSV file from the server
  function isAlreadyUploadedServer(serverList, name, mtimeMs) {
    if (!Array.isArray(serverList)) return false;
    const found = serverList.find(
      (f) => f && f.name === name && f.mtimeMs === mtimeMs
    );
    return !!found;
  }

  // download and import a CSV file from the server
  function importFromCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    let rowsProcessed = 0;

    // look for MHz or kHz header to verify valid CSV
    const headerLineIndex = lines.findIndex((line) => {
      const l = line.toLowerCase();
      return l.includes("mhz") || l.includes("khz");
    });

    // if khz or mhz not found, exit
    if (headerLineIndex === -1) {
      sendToast('error', pluginName, "CSV file does not contain MHz or kHz header.");
      return;
    }

    // read the table header line (column names)
    const headers = lines[headerLineIndex]
      .split(";")
      .map((h) => h.trim().toLowerCase());

    // map relevant column indices
    const getIndex = (name) => headers.indexOf(name);
    const idxMHz = getIndex("mhz");
    const idxKHz = getIndex("khz");
    const isKHz = idxKHz !== -1;

    const idxProgram = getIndex("program");
    const idxITU = getIndex("itu");
    const idxLocation = getIndex("location");
    const idxReg = getIndex("reg");
    const idxQTF = getIndex("qtf");
    const idxKW = getIndex("kw");
    const idxQRB =
      getIndex("qrb km") !== -1 ? getIndex("qrb km") : getIndex("qrb");
    const idxPI = getIndex("pi");
    const idxDate = getIndex("date");

    // verify at least Program and MHz or kHz are present
    if (idxProgram === -1 || (idxMHz === -1 && idxKHz === -1)) {
      sendToast('error', pluginName, "CSV must contain Program and MHz or kHz columns.");
      return;
    }

    // Ask the user whether to add or replace
    const addToExisting = isServerImport
      ? true
      : confirm(
          "Do you want to add the new records to the existing ones? (OK = add, Cancel = replace)"
        );

    const newNotes = {};

    function parseCsvDate(str) {
      if (!str) return null;
      str = str.trim();
      // try ISO
      const iso = Date.parse(str);
      if (!isNaN(iso)) return iso;
      // try dd.mm.yyyy or dd.mm.yy or dd/mm/yyyy
      const m = str.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})$/);
      if (m) {
        let day = parseInt(m[1], 10);
        let month = parseInt(m[2], 10) - 1;
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d.getTime();
      }
      return null;
    }

    function parseExistingNoteMetadata(note) {
      if (!note) return { station: "", dateTs: null };
      // try to extract station/program after the frequency
      const m = note.match(/^\s*\d+\.?\d*\s+([^–\(]+)/);
      const station = m ? m[1].trim() : "";
      // try to extract trailing date in parentheses
      const dm = note.match(/\(([^)]+)\)\s*$/);
      const dateTs = dm ? parseCsvDate(dm[1]) : null;
      return { station, dateTs };
    }

    // local function: convert frequency string to number
    // handles formats with spaces after mhz and commas as decimal separator
    function parseFrequency(value) {
      if (!value) return NaN;
      let str = value
        .toString()
        .replace(/mhz|khz/gi, "") // remove units
        .replace(/\s+/g, "") // remove all spaces
        .replace(",", "."); // convert comma to dot
      const freq = parseFloat(str);
      return isNaN(freq) ? NaN : freq;
    }

    // process the rows following the header containing data
    lines.slice(headerLineIndex + 1).forEach((line) => {
      // skip empty rows
      if (!line.trim()) return;
      rowsProcessed++;

      // split row into columns
      const cols = line.split(";");

      // read frequency
      let freq = parseFrequency(cols[isKHz ? idxKHz : idxMHz]);
      // skip if not a valid number
      if (isNaN(freq)) return;

      // convert to MHz if necessary
      if (isKHz) freq = freq / 1000;

      const noteParts = [];

      // Frequency + program
      let firstPart = `${freq.toFixed(3)}`;
      if (idxProgram !== -1) firstPart += ` ${cols[idxProgram]?.trim()}`; // space only
      noteParts.push(firstPart);

      // ITU
      if (idxITU !== -1 && cols[idxITU]?.trim())
        noteParts.push(cols[idxITU].trim());

      // Location, Reg, QTF, KW, QRB, PI
      let locRegQtfKw = "";
      if (idxLocation !== -1 && cols[idxLocation]?.trim()) {
        locRegQtfKw += cols[idxLocation].trim();
        if (idxReg !== -1 && cols[idxReg]?.trim())
          locRegQtfKw += ` (${cols[idxReg].trim()})`;
      }

      if (idxQTF !== -1 && cols[idxQTF]?.trim()) {
        const qtfVal = parseFloat(cols[idxQTF].replace(",", "."));
        if (!isNaN(qtfVal)) {
          const { dir, arrow } = qtfToDirectionArrow(qtfVal);
          locRegQtfKw += ` ${qtfVal}° (${dir} ${arrow})`;
        }
      }
      if (idxKW !== -1 && cols[idxKW]?.trim())
        locRegQtfKw += ` ${cols[idxKW].trim()} kW`;
      locRegQtfKw += " -";
      if (idxQRB !== -1 && cols[idxQRB]?.trim())
        locRegQtfKw += ` ${cols[idxQRB].trim()} km`;
      locRegQtfKw += " -";
      if (idxPI !== -1 && cols[idxPI]?.trim())
        locRegQtfKw += ` PI=${cols[idxPI].trim()}`;

      if (locRegQtfKw) noteParts.push(locRegQtfKw);

      // join note parts using " – " as separator
      const finalNote = noteParts.filter(Boolean).join(" – ");
      // use "Date" field if present; otherwise add nothing
      let finalNoteWithDate = finalNote;
      if (idxDate !== -1 && cols[idxDate] && cols[idxDate].trim()) {
        finalNoteWithDate = `${finalNote} (${cols[idxDate].trim()})`;
      }

      // Key always 3 decimals
      const freqKey = freq.toFixed(3);

      // add the note (with metadata)
      if (!newNotes[freqKey]) newNotes[freqKey] = [];
      const stationName =
        (idxProgram !== -1 ? cols[idxProgram]?.trim() || "" : "") ||
        (idxLocation !== -1 ? cols[idxLocation]?.trim() || "" : "");
      const rowDateStr =
        idxDate !== -1 && cols[idxDate] ? cols[idxDate].trim() : "";
      const rowDateTs = parseCsvDate(rowDateStr);
      newNotes[freqKey].push({
        station: stationName,
        note: finalNoteWithDate,
        dateTs: rowDateTs,
        dateStr: rowDateStr,
      });
    });

    // De-duplicate imported records: for each freq+station pick the most recent date
    const selectedNotes = {};
    for (const freq in newNotes) {
      const entries = newNotes[freq];
      const byStation = {};
      entries.forEach((ent) => {
        const key = (ent.station || "").toLowerCase();
        if (!byStation[key]) byStation[key] = ent;
        else {
          const a = byStation[key];
          // prefer entries with more recent dates
          if ((ent.dateTs || 0) > (a.dateTs || 0)) byStation[key] = ent;
        }
      });
      selectedNotes[freq] = Object.values(byStation).map((e) => e.note);
    }

    // merge or replace existing notes
    if (addToExisting) {
      // merge with existing notesMap avoiding station+freq duplicates
      for (const freq in selectedNotes) {
        if (!notesMap[freq]) notesMap[freq] = [];
        const existing = notesMap[freq];
        const merged = [...existing];
        selectedNotes[freq].forEach((newNote) => {
          const metaNew = parseExistingNoteMetadata(newNote);
          let replaced = false;
          for (let i = 0; i < merged.length; i++) {
            const metaExist = parseExistingNoteMetadata(merged[i]);
            if (
              metaExist.station &&
              metaNew.station &&
              metaExist.station.toLowerCase() === metaNew.station.toLowerCase()
            ) {
              // compare dates
              if ((metaNew.dateTs || 0) > (metaExist.dateTs || 0)) {
                merged[i] = newNote; // replace with newer
              }
              replaced = true;
              break;
            }
          }
          if (!replaced) merged.push(newNote);
        });
        notesMap[freq] = merged;
      }
    } else {
      // completely replace with selected records
      const newMap = {};
      for (const freq in selectedNotes) newMap[freq] = selectedNotes[freq];
      notesMap = newMap;
    }

    // import statistics
    const freqCount = Object.keys(newNotes).length;
    const recordCount = Object.values(newNotes).reduce(
      (s, arr) => s + (Array.isArray(arr) ? arr.length : 0),
      0
    );
    console.log(
      `[${pluginName}] Imported ${recordCount} records across ${freqCount} frequencies (processed ${rowsProcessed} CSV rows)`
    );

    saveNotes();
    openManager();
  }

  async function importFromGitHub(forcedUrl = null, isAutoStartup = false) {
    const defaultRepoPath = ""; 
    let fullRepoPathInput;

    if (forcedUrl) {
        fullRepoPathInput = forcedUrl;
    } else {
        fullRepoPathInput = prompt("Inserisci il percorso del repository GitHub (es. 'utente/repo/path/to/folder' o URL completo):", localStorage.getItem("LoggedStationsRemoteUrl") || "");
    }

    if (!fullRepoPathInput) {
        if (!isAutoStartup) console.log(`[${pluginName}] GitHub import cancelled by user.`);
        return;
    }

    // Salva l'ultimo URL usato
    if (!forcedUrl) localStorage.setItem("LoggedStationsRemoteUrl", fullRepoPathInput);

    let owner, repo, branch, contentPath;

    // Tenta di parsare come un URL completo di GitHub
    const githubUrlMatch = fullRepoPathInput.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+))?\/?(.*)$/i);

    if (githubUrlMatch) {
        owner = githubUrlMatch[1];
        repo = githubUrlMatch[2];
        branch = githubUrlMatch[3];
        contentPath = (githubUrlMatch[4] || "").replace(/^\/+|\/+$/g, ""); // Pulisce slash iniziali e finali
    } else {
        // Altrimenti, assume il formato 'owner/repo/path/to/folder'
        const parts = fullRepoPathInput.split('/');
        if (parts.length < 2) { // Almeno owner/repo
            sendToast('error', pluginName, "Formato percorso GitHub non valido. Deve essere 'utente/repo/path/to/folder' o un URL completo.");
            return;
        }
        owner = parts[0];
        repo = parts[1];
        contentPath = parts.slice(2).join('/');
    }

    if (!owner || !repo) {
        sendToast('error', pluginName, "Impossibile estrarre proprietario o repository dal percorso GitHub fornito.");
        return;
    }

    let apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}`;
    if (branch) apiUrl += `?ref=${branch}`;

    const checkMsg = `Checking GitHub: ${owner}/${repo}/${contentPath}${branch ? ' [' + branch + ']' : ''}`;
    sendToast('info', pluginName, checkMsg, 3000);

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            let errorMessage = `Error accessing GitHub URL: ${apiUrl}\nStatus: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData && errorData.message) {
                    errorMessage += ` - ${errorData.message}`;
                }
            } catch (jsonError) {
                // Ignora errori di parsing JSON se la risposta non è JSON
            }
            throw new Error(errorMessage);
        }
        
        const files = await response.json();
        
        if (!Array.isArray(files)) {
            throw new Error("Il percorso fornito non sembra essere una directory valida su GitHub.");
        }

        const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));

        if (csvFiles.length === 0) {
            console.warn(`[${pluginName}] No CSV files found in the remote GitHub directory.`);
            return;
        }

        if (!isAutoStartup && !confirm(`Found ${csvFiles.length} files on GitHub. Do you want to import them all?`)) {
            return;
        }

        isServerImport = true; // Use server import flag to avoid individual confirms during batch
        let count = 0;
        for (const file of csvFiles) {
            try {
                const fileRes = await fetch(file.download_url);
                const csvText = await fileRes.text();
                importFromCSV(csvText);

                // Traccia il file importato da GitHub nel localStorage
                const remoteStore = JSON.parse(localStorage.getItem("LoggedStationsRemoteFiles") || "{}");
                remoteStore[file.name] = { 
                    mtimeMs: Date.now(), 
                    source: 'GitHub',
                    path: `${owner}/${repo}/${file.path}`
                };
                localStorage.setItem("LoggedStationsRemoteFiles", JSON.stringify(remoteStore));

                count++;
            } catch (e) {
                sendToast('error', pluginName, `Error downloading file: ${file.name}\nURL: ${file.download_url}`);
            }
        }
        isServerImport = false;
        console.log(`[${pluginName}] Successfully imported ${count} files from GitHub.`);
    } catch (error) {
        sendToast('error', pluginName, "GitHub Import Error: " + error.message);
    }
  }

  function showStartupSettings() {
    const behavior = pluginSettings.startupBehavior;
    const githubUrl = pluginSettings.remoteUrl;

    const html = `
      <h3>Startup Settings</h3>
      <p style="margin-bottom:15px; color:#ccc;">Choose what the plugin should do when it starts up:</p>
      <div style="margin-bottom:20px;">
        <label style="display:block; margin-bottom:12px; cursor:pointer; font-size:14px;">
          <input type="radio" name="startupBehavior" value="server" ${behavior === 'server' ? 'checked' : ''}> 
          Download from local server (/files folder)
        </label>
        <label style="display:block; margin-bottom:12px; cursor:pointer; font-size:14px;">
          <input type="radio" name="startupBehavior" value="remote" ${behavior === 'remote' ? 'checked' : ''}> 
          Download from GitHub
        </label>
        <div id="startupRemoteUrlContainer" style="margin-left:25px; margin-bottom:15px; display: ${behavior === 'remote' ? 'block' : 'none'};">
            <div style="display:flex; gap:5px; align-items:center;">
                <input type="text" id="startupRemoteUrl" value="${githubUrl}" style="flex-grow:1; background:#333; color:#eee; border:1px solid #555; padding:8px; font-size:12px; border-radius:4px;" placeholder="GitHub URL or user/repo/path">
                <button id="verifyRemoteUrlBtn" style="padding:6px 10px; cursor:pointer; background:#444; color:white; border:1px solid #666; border-radius:4px; font-size:11px; white-space:nowrap;" title="Check if URL is valid and contains CSV files">Verify</button>
            </div>
        </div>
        <label style="display:block; margin-bottom:12px; cursor:pointer; font-size:14px;">
          <input type="radio" name="startupBehavior" value="none" ${behavior === 'none' ? 'checked' : ''}> 
          Do not download data automatically (local only)
        </label>
      </div>
      <div style="margin-top:15px; border-top:1px solid #444; padding-top:15px;">
        <label style="display:block; margin-bottom:8px; font-size:14px; font-weight:bold;">Visibility:</label>
        <label style="display:block; margin-bottom:12px; cursor:pointer; font-size:14px;">
          <input type="radio" name="showToAllUsers" value="true" ${pluginSettings.showToAllUsers ? 'checked' : ''}> 
          Show stations to all users
        </label>
        <label style="display:block; margin-bottom:12px; cursor:pointer; font-size:14px;">
          <input type="radio" name="showToAllUsers" value="false" ${!pluginSettings.showToAllUsers ? 'checked' : ''}> 
          Show to administrators only
        </label>
      </div>
      <div style="margin-top:15px; border-top:1px solid #444; padding-top:15px; margin-bottom:20px;">
        <label style="display:block; margin-bottom:8px; font-size:14px; font-weight:bold;">FMLIST OMID:</label>
        <input type="text" id="lsOmidInput" value="${pluginSettings.fmlistOmid || ''}" 
               style="width:100%; background:#333; color:#eee; border:1px solid #555; padding:8px; font-size:12px; border-radius:4px;" 
               placeholder="Enter your OMID (e.g. 10038)">
        <p style="font-size:11px; color:#888; margin-top:4px;">Required for sending logs to FMLIST.</p>
      </div>
      <button id="saveStartupBtn" style="padding:8px 16px; cursor:pointer; background:var(--color-5); color:white; border:none; border-radius:4px; font-weight:bold;">Save Settings</button>
    `;

    showSecondPopup(html);

    const popup = document.getElementById('LoggedStationsSecondPopup');
    const radios = popup.querySelectorAll('input[name="startupBehavior"]');
    const urlContainer = popup.querySelector('#startupRemoteUrlContainer');
    const urlInput = popup.querySelector('#startupRemoteUrl');

    radios.forEach(r => { r.onchange = () => { urlContainer.style.display = r.value === 'remote' ? 'block' : 'none'; }; });

    popup.querySelector('#verifyRemoteUrlBtn').onclick = async () => {
        const url = urlInput.value.trim();
        if (!url) {
            sendToast('warning', pluginName, "Inserisci prima un URL o un percorso GitHub.");
            return;
        }

        let owner, repo, branch, contentPath;
        const githubUrlMatch = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+))?\/?(.*)$/i);

        if (githubUrlMatch) {
            owner = githubUrlMatch[1];
            repo = githubUrlMatch[2];
            branch = githubUrlMatch[3];
            contentPath = (githubUrlMatch[4] || "").replace(/^\/+|\/+$/g, "");
        } else {
            const parts = url.split('/');
            if (parts.length < 2) {
                sendToast('error', pluginName, "Formato non valido. Usa 'utente/repo/percorso' o un URL completo.");
                return;
            }
            owner = parts[0];
            repo = parts[1];
            contentPath = parts.slice(2).join('/');
        }

        let apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}`;
        if (branch) apiUrl += `?ref=${branch}`;

        sendToast('info', pluginName, `Verifica in corso: ${owner}/${repo}...`, 2000);

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                let errorMessage = `Status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.message) {
                        errorMessage += ` - ${errorData.message}`;
                    }
                } catch (jsonError) {} // Ignore JSON parsing errors
                throw new Error(errorMessage);
            }
            const files = await response.json();
            if (!Array.isArray(files)) throw new Error("Il percorso non è una directory valida.");
            const csvCount = files.filter(f => f.name.toLowerCase().endsWith('.csv')).length;
            sendToast('success', pluginName, `URL Valido! Trovati ${csvCount} file CSV.\nURL: ${apiUrl}`);
        } catch (e) {
            sendToast('error', pluginName, `Verifica fallita: ${e.message}\nURL: ${apiUrl}`);
        }
    };

    popup.querySelector('#saveStartupBtn').onclick = async () => {
      const selected = popup.querySelector('input[name="startupBehavior"]:checked').value;
      const remoteUrl = urlInput.value.trim();
      const fmlistOmid = popup.querySelector('#lsOmidInput').value.trim();
      const showToAllUsers = popup.querySelector('input[name="showToAllUsers"]:checked').value === 'true';
      
      const newSettings = { startupBehavior: selected, remoteUrl: remoteUrl, fmlistOmid: fmlistOmid, showToAllUsers: showToAllUsers };
      
      try {
          const res = await fetch('/plugins/LoggedStations/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newSettings)
          });
          if (res.ok) {
              pluginSettings = newSettings;
              localStorage.setItem("LoggedStationsStartupBehavior", selected);
              localStorage.setItem("LoggedStationsRemoteUrl", remoteUrl);
              localStorage.setItem("LoggedStationsOmid", fmlistOmid);
              localStorage.setItem("LoggedStationsShowToAll", showToAllUsers);
              sendToast('success', pluginName, "Startup settings saved on server!");
              popup.remove();
          } else { 
              throw new Error(`Server returned status ${res.status} (${res.statusText})`); 
          }
      } catch (e) {
          const errorDetail = e.message || "Unknown error";
          const errorMessage = `Error saving settings to server: ${errorDetail}\n\n` +
                               `Common causes:\n` +
                               `- Missing write permissions on 'plugins_configs' folder\n` +
                               `- Server is offline or unreachable\n` +
                               `- Backend script 'pluginLoggedStations_server.js' not loaded in LoggedStations.js`;
          
          sendToast('error', pluginName, errorMessage);
      }
    };
  }

  // ==============================
  // POPUP HANDLING
  // ==============================

  // ==============================
  // SAVE NOTES LOCALLY
  // ==============================
  function saveNotes() {
    localStorage.setItem("LoggedStationsMap", JSON.stringify(notesMap));
    console.log(
      `[${pluginName}] Saved ${Object.keys(notesMap).length} notes locally`
    );
    updateNotes(freq);
  }


  function addManageButton() {
    const BTN_ID = "logged-stations-btn";
    const MAX_RETRIES = 15;
    const RETRY_DELAY = 400;

    let attempts = 0;

    function tryAdd() {
      attempts++;

      // avoid duplicates
      if (document.getElementById(BTN_ID)) return;

      // plugin function not ready yet
      if (typeof window.addIconToPluginPanel !== "function") {
        if (attempts < MAX_RETRIES) {
          setTimeout(tryAdd, RETRY_DELAY);
        } else {
          console.warn(
            `[${pluginName}] addIconToPluginPanel not available, giving up`
          );
        }
        return;
      }

      // create button
      window.addIconToPluginPanel(
        BTN_ID,
        "Logged Stations",
        "solid",
        "note-sticky",
        "Logged Stations"
      );

      const btn = document.getElementById(BTN_ID);
      if (!btn) {
        if (attempts < MAX_RETRIES) {
          setTimeout(tryAdd, RETRY_DELAY);
        }
        return;
      }

      btn.classList.add("hide-phone", "bg-color-2");
      btn.addEventListener("click", openManager);
    }

    tryAdd();
  }

  // ==============================
  // CHECK SERVER FOR BANDSCAN FILES
  // ==============================
  async function checkServerCSVFiles() {
    try {
      const response = await fetch("/plugins/LoggedStations/files");
      if (!response.ok) return;

      const csvFiles = await response.json();
      if (!Array.isArray(csvFiles) || csvFiles.length === 0) return;

      // before downloading, if no local records exist, clear markers to allow re-import
      if (Object.keys(notesMap).length === 0) {
        try {
          const localStore = loadUploadedStore();
          const localNames = Object.keys(localStore);
          if (localNames.length > 0 || csvFiles.some((f) => f && f.uploaded)) {
            console.log(
              `[${pluginName}] No local records found — clearing uploaded markers (${localNames.length} local)`
            );
            // clear local store
            saveUploadedStore({});
            // notify server for marked files
            for (const f of csvFiles) {
              if (f && (f.uploaded || localNames.includes(f.name))) {
                try {
                  const res = await fetch(
                    `/plugins/LoggedStations/files/${encodeURIComponent(f.name)}/unmarkUploaded`,
                    { method: "POST" }
                  );
                  if (res.ok) {
                    console.log(`[${pluginName}] Server unmarked ${f.name}`);
                    f.uploaded = false;
                  } else {
                    console.warn(
                      `[${pluginName}] Server unmark failed for ${f.name} (status ${res.status})`
                    );
                  }
                } catch (e) {
                  console.warn(
                    `[${pluginName}] Error calling server unmark for`,
                    f.name,
                    e
                  );
                }
              }
            }
          }
        } catch (e) {
          console.warn(
            `[${pluginName}] Error while clearing uploaded markers`,
            e
          );
        }
      }

      // ⚠️ flag that import is from server
      isServerImport = true;

      for (const fileObj of csvFiles) {
        const name = fileObj && fileObj.name ? fileObj.name : fileObj;
        const mtime = fileObj && fileObj.mtimeMs ? fileObj.mtimeMs : null;

        // if server already marked file as 'uploaded', skip (log)
        if (fileObj && fileObj.uploaded && mtime) {
          console.log(
            `[${pluginName}] Server file marked uploaded, skipping: ${name} (mtime:${mtime})`
          );
          continue;
        }

        // skip if already imported locally (same name+date) and log
        if (isAlreadyUploadedLocal(name, mtime)) {
          console.log(
            `[${pluginName}] Skipping server file ${name} because already imported locally (mtime:${mtime})`
          );
          continue;
        }

        await downloadCSVFile(name, mtime);
      }

      isServerImport = false;
    } catch (err) {
      console.error("Errore caricamento CSV dal server:", err);
      isServerImport = false;
    }
  }

  // ==============================
  // DOWNLOAD DATA FROM SERVER
  // ==============================
  // function to download and import a CSV using importFromCSV
  function downloadCSVFile(fileName, mtime = null) {
    fetch(`/plugins/LoggedStations/files/${encodeURIComponent(fileName)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to download ${fileName}`);
        return response.text();
      })
      .then((csvText) => {
        console.log(`[${pluginName}] Downloaded CSV file: ${fileName}`);
        isServerImport = true; // server import flag
        importFromCSV(csvText);
        // mark as imported locally and notify server
        markFileUploaded(fileName, mtime || Date.now());
        isServerImport = false; // reset
      })
      .catch((err) => {
        console.error(
          `[${pluginName}] Could not download ${fileName}: ${err.message}`
        );
      });
  }

  // ==============================
  // POPUP HANDLING
  // ==============================
  function showPopup(html) {
    // create a backdrop to close the popup by clicking outside
    const backdrop = document.createElement("div");
    backdrop.id = "LoggedStationsBackdrop";
    backdrop.style.position = "fixed";
    backdrop.style.top = "0";
    backdrop.style.left = "0";
    backdrop.style.width = "100vw";
    backdrop.style.height = "100vh";
    backdrop.style.background = "rgba(0,0,0,0.5)";
    backdrop.style.zIndex = 9998;
    backdrop.onclick = closePopup;
    document.body.appendChild(backdrop);

    const popup = document.createElement("div");
    popup.id = "LoggedStationsPopup";
    popup.style.position = "fixed";
    popup.style.top = "50%";
    popup.style.left = "50%";
    popup.style.transform = "translate(-50%, -50%)";
    popup.style.background = "#222";
    popup.style.color = "#fff";
    popup.style.zIndex = 9999;
    popup.style.borderRadius = "8px";
    popup.style.width = "70%"; // widened to 70% of the window
    popup.style.maxWidth = "1200px"; // maximum limit
    popup.style.maxHeight = "85vh"; // maximum height
    popup.style.display = "flex";
    popup.style.flexDirection = "column";
    popup.style.boxShadow = "0 0 15px rgba(0,0,0,0.6)";
    document.body.appendChild(popup);

    const headerHTML = `
      <div id="LoggedStationsPopupHeader" style="
        padding: 10px;
        cursor: move;
        background: #333;
        border-bottom: 1px solid #444;
        border-radius: 8px 8px 0 0;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-shrink: 0;
      ">
        <span style="font-weight:bold;">LoggedStations (v. ${pluginVersion})</span>
      </div>
    `;

    const contentHTML = `
      <div style="padding: 20px; overflow-y: auto; flex-grow: 1;">
        ${html}
      </div>
    `;

    popup.innerHTML = headerHTML + contentHTML;

    // Drag logic
    const header = document.getElementById("LoggedStationsPopupHeader");
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      
      if (popup.style.transform) {
          const rect = popup.getBoundingClientRect();
          popup.style.transform = "none";
          popup.style.top = rect.top + "px";
          popup.style.left = rect.left + "px";
      }

      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      popup.style.top = (popup.offsetTop - pos2) + "px";
      popup.style.left = (popup.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  function showSecondPopup(html) {
    // remove if exists to avoid duplicates
    const oldPopup = document.getElementById("LoggedStationsSecondPopup");
    if (oldPopup) oldPopup.remove();

    const popup = document.createElement("div");
    popup.id = "LoggedStationsSecondPopup";
    popup.style.position = "fixed";
    popup.style.top = "55%"; // slightly lower to not completely cover the main one
    popup.style.left = "55%";
    popup.style.transform = "translate(-50%, -50%)";
    popup.style.background = "#2a2a2a";
    popup.style.color = "#fff";
    popup.style.padding = "20px";
    popup.style.zIndex = 10000; // higher than main popup and backdrop
    popup.style.borderRadius = "8px";
    popup.style.width = "50%";
    popup.style.maxWidth = "800px";
    popup.style.maxHeight = "60vh";
    popup.style.overflowY = "auto";
    popup.style.boxShadow = "0 0 15px rgba(0,0,0,0.8)";
    
    const content = `
        ${html}
        <br>
        <button onclick="document.getElementById('LoggedStationsSecondPopup').remove()" style="padding:4px 8px; font-size:12px; margin-top: 10px;" title="Close this window">Close</button>`;
    popup.innerHTML = content;
    document.body.appendChild(popup);

    // Add click-to-tune functionality
    popup.querySelectorAll("li[data-freq]").forEach((li) => {
      li.onclick = () => {
        const newFreq = parseFloat(li.dataset.freq);
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
          try {
            // The 'T' command expects frequency in kHz
            window.socket.send('T' + Math.round(newFreq * 1000));
            closePopup(); // closes main popup and backdrop
            const secondPopup = document.getElementById("LoggedStationsSecondPopup");
            if (secondPopup) secondPopup.remove();
          } catch (err) {
            console.error(`[${pluginName}] Error tuning frequency:`, err);
            sendToast('error', pluginName, "Error: Could not tune to frequency via socket.");
          }
        } else {
          console.error(`[${pluginName}] WebSocket (socket) not available or not open.`);
          sendToast('error', pluginName, "Error: Could not tune to frequency.");
        }
      };
    });
  }

  function closePopup() {
    const popup = document.getElementById("LoggedStationsPopup");
    if (popup) popup.remove();
    const backdrop = document.getElementById("LoggedStationsBackdrop");
    if (backdrop) backdrop.remove();
  }

  // ==============================
  // OBSERVE FREQUENCY CHANGES
  // ==============================
  function getFreq() {
    const targetNode = document.getElementById("data-frequency");
    const observer = new MutationObserver(() => {
      const newFreq = Number(data.freq) || Number(targetNode.textContent);
      if (freq !== newFreq) {
        freq = newFreq;
        updateNotes(freq);
      }
    });
    if (window.location.pathname !== "/setup") {
      observer.observe(targetNode, { childList: true, subtree: true });
    }
  }

  // ==============================
  // LOG LOADED NOTES
  // ==============================
  function drawIcon() {
    if (Object.keys(notesMap).length > 0) {
      console.log(
        `[${pluginName}] Loaded ${Object.keys(notesMap).length} notes from localStorage`
      );
    }
  }
})();
