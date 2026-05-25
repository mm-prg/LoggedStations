/*
    LoggedStations
*/

"use strict";

(() => {
  // ==============================
  // GLOBAL VARIABLES
  // ==============================
  const pluginName = "LoggedStations";
  const pluginVersion = "0.0.1";
  let notesMap = JSON.parse(localStorage.getItem("LoggedStationsMap") || localStorage.getItem("BandscanLogMap") || "{}");
  let freq = null;
  let isServerImport = false;

  const CHECK_FOR_UPDATES = true;
  const pluginSetupOnlyNotify = true;
  const pluginHomepageUrl  = "https://github.com/mm-prg/LoggedStations"; // As per TODO
  const pluginUpdateUrl    = "https://raw.githubusercontent.com/mm-prg/LoggedStations/main/LoggedStations/pluginLoggedStations.js"; // Placeholder

  // ==============================
  // INITIALIZATION
  // ==============================
  document.addEventListener("DOMContentLoaded", () => {
    getFreq();
    drawIcon();
    initMainPanel();
    // pulsante nello spazio dei plugin, non più usato perché adesso si fa tutto con l'icona
    // addManageButton();
    checkServerCSVFiles();
    if (CHECK_FOR_UPDATES) {
        checkUpdate(pluginSetupOnlyNotify, pluginName, pluginHomepageUrl, pluginUpdateUrl);
    }
  });

  // ==============================
  // UPDATE CHECK (from Scanner plugin)
  // ==============================
  function checkUpdate(setupOnly, pluginName, urlUpdateLink, urlFetchLink) {
    if (setupOnly && window.location.pathname !== '/setup') return;

    let pluginVersionCheck = typeof pluginVersion !== 'undefined' ? pluginVersion : 'Unknown';

    async function fetchRemoteVersion() {
        const urlCheckForUpdate = urlFetchLink;
        try {
            const response = await fetch(urlCheckForUpdate);
            if (!response.ok) {
                throw new Error(`[${pluginName}] update check HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            const lines = text.split('\n');
            let version;

            // Try to find version in comment like: /* LoggedStations 0.0.6 (19.1.2026) */
            const commentMatch = lines[0].match(/\/\*\s*LoggedStations\s+([0-9\.]+)/);
            if (commentMatch && commentMatch[1]) {
                version = commentMatch[1];
            } else {
                version = "Unknown";
            }
            return version;
        } catch (error) {
            console.error(`[${pluginName}] error fetching file:`, error);
            return null;
        }
    }

    fetchRemoteVersion().then(newVersion => {
        if (newVersion && newVersion !== pluginVersionCheck) {
            const updateConsoleText = "There is a new version of this plugin available";
            console.log(`[${pluginName}] ${updateConsoleText}: ${pluginVersionCheck} -> ${newVersion}`);
            setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink);
        }
    });

    function setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink) {
        if (window.location.pathname === '/setup') {
            const pluginSettings = document.getElementById('plugin-settings');
            if (pluginSettings) {
                const currentText = pluginSettings.textContent.trim();
                const newText = `<a href="${urlUpdateLink}" target="_blank">[${pluginName}] Update available: ${pluginVersionCheck} --> ${newVersion}</a><br>`;

                if (currentText === 'No plugin settings are available.') {
                    pluginSettings.innerHTML = newText;
                } else {
                    pluginSettings.innerHTML += ' ' + newText;
                }
            }

            const updateIcon = document.querySelector('.wrapper-outer #navigation .sidenav-content .fa-puzzle-piece') || document.querySelector('.wrapper-outer .sidenav-content') || document.querySelector('.sidenav-content');
            if (updateIcon) {
                const redDot = document.createElement('span');
                redDot.style.display = 'block';
                redDot.style.width = '12px';
                redDot.style.height = '12px';
                redDot.style.borderRadius = '50%';
                redDot.style.backgroundColor = '#FE0830';
                redDot.style.marginLeft = '82px';
                redDot.style.marginTop  = '-12px';
                updateIcon.appendChild(redDot);
            }
        }
    }
  }

  // ==============================
  // UPDATE STATION ICON & TOOLTIP
  // ==============================
  function performFmlistLog(btn, freq, pi, ps, sid, dist, itu) {
    const logMsg = `LoggedStations: ${ps || 'Station'} [${itu || ''}], PI: ${pi || '?'}, Dist: ${dist}km`;
    
    if (!confirm(`Confermi l'invio del log a FMLIST?\n\nMessaggio: "${logMsg}"`)) {
        return;
    }

    const btnText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "...";

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
        if (result.ok) sendToast('success', pluginName, "Log inviato a FMLIST con successo!");
        else sendToast('error', pluginName, "Errore durante l'invio: " + (result.error || "Unknown"));
    })
    .catch(err => {
        sendToast('error', pluginName, "Errore di rete: " + err.message);
    })
    .finally(() => {
        btn.disabled = false;
        btn.textContent = btnText;
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
    mainPanel.style.margin = "10px auto";
    mainPanel.style.padding = "10px";
    mainPanel.style.boxSizing = "border-box";
    mainPanel.style.background = "var(--bg-color-2, #2a2a2a)";
    mainPanel.style.borderRadius = "4px";
    mainPanel.style.borderLeft = "3px solid var(--color-5)";
    mainPanel.style.display = "none";
    mainPanel.style.fontSize = "13px";
    mainPanel.style.lineHeight = "1.4";
    mainPanel.style.color = "#eee";
    mainPanel.style.maxHeight = "300px";
    mainPanel.style.overflowY = "auto";

    const syncWidth = () => {
      mainPanel.style.width = wrapper.getBoundingClientRect().width + "px";
    };

    if (wrapper.parentNode) {
      wrapper.parentNode.insertBefore(mainPanel, wrapper.nextSibling);
      syncWidth();
      window.addEventListener("resize", syncWidth);
    }
  }

  function updateNotes(f) {
    const freqContainer = document.getElementById("freq-container");
    if (!freqContainer) return;

    // Cerca stazioni per la frequenza corrente e quelle vicine
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
        const note = item.record;
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

    // Aggiorna l'elemento nella pagina principale
    const mainPanel = document.getElementById("logged-stations-main-panel");
    const qthLat = localStorage.getItem("qthLatitude") || "";
    const qthLon = localStorage.getItem("qthLongitude") || "";

    if (mainPanel) {
      if (stationData.length > 0) {
        mainPanel.style.display = "block";

        const isFMCurrent = f > 50;
        const isSWCurrent = f >= 2.3 && f < 50;
        const isLWMWCurrent = f < 2.3;

        const toolbarBtnStyle = "padding:1px 0; font-size:10px; margin:0; line-height:1; width:45px; text-align:center; height:18px; cursor:pointer;";
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
            toolbarBtns.push(`<a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank"><button style="${toolbarBtnStyle}">SW-Log</button></a>`);
        } else if (isLWMWCurrent) {
            toolbarBtns.push(`<a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank"><button style="${toolbarBtnStyle}">MW-Log</button></a>`);
        }
        const toolbarHtml = toolbarBtns.length > 0 ? `<div style="display:flex; gap:2px; flex-shrink:0;">${toolbarBtns.join('')}</div>` : '';

        const header = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
                <div style="display:flex; align-items:center; font-weight: bold; font-size:11px; color: var(--color-5); white-space:nowrap; position:relative;">
                    <i class="fa-solid fa-bars" id="ls-menu-btn" style="cursor:pointer; margin-right:8px; padding: 2px 5px;" title="Plugin Menu"></i>
                    <div id="ls-dropdown-menu" style="display:none; position:absolute; top:22px; left:0; background: #2a2a2a; border:1px solid #555; border-radius:4px; z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.5); min-width:170px; padding:4px 0;">
                        <div class="ls-dropdown-item" data-action="import-csv" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">⬆ Import CSV</div>
                        <div class="ls-dropdown-item" data-action="export-json" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">⬇ Export JSON</div>
                        <div class="ls-dropdown-item" data-action="show-data" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px; border-bottom:1px solid #444;">📊 Show All Data</div>
                        <div class="ls-dropdown-item" data-action="info" style="padding:8px 12px; cursor:pointer; font-weight:normal; color:#eee; font-size:12px;">ℹ️ Info</div>
                    </div>
                    ${pluginName} v${pluginVersion} <span style="color:#888; margin-left:8px;">${f.toFixed(3)} MHz</span>
                </div>
                ${toolbarHtml}
            </div>`;

        const list = stationData.map((item, idx) => {
            const cleanNote = item.formatted.replace(/\u00A0/g, ' ');
            const meta = extractMetadata(item.record);
            const freqNum = parseFloat(item.freq);
            const isFM = freqNum > 50;
            const isSW = freqNum >= 2.3 && freqNum < 50;
            const isLWMW = freqNum < 2.3;
            
            const btnStyle = "padding:1px 0; font-size:10px; margin:0; line-height:1; width:45px; text-align:center; height:18px;";
            let actionBtns = [];

            if (isFM) {
                actionBtns.push(`<a href="https://maps.fmdx.org/#qth=${qthLat},${qthLon}&freq=${item.freq}&findPi=${meta.pi}" target="_blank"><button style="${btnStyle}" title="FMDX PI">PI</button></a>`);
                actionBtns.push(`<a href="https://maps.fmdx.org/#lat=${qthLat}&lon=${qthLon}&freq=${item.freq}&r=300" target="_blank"><button style="${btnStyle}" title="FMDX Freq">Map</button></a>`);
                actionBtns.push(`<a href="https://fmscan.org/main.php?f=${item.freq}&maptype=2&m=m&area=300" target="_blank"><button style="${btnStyle}" title="FMScan">Scan</button></a>`);
                actionBtns.push(`<a href="https://fmstream.org/?s=${encodeURIComponent(meta.name)}" target="_blank"><button style="${btnStyle}" title="FMStream">Live</button></a>`);
                actionBtns.push(`<button class="mini-btn log-action" data-idx="${idx}" style="${btnStyle}">Log</button>`);
                if (meta.pi) {
                    actionBtns.push(`<button class="mini-btn af-action" data-idx="${idx}" style="${btnStyle}">AF</button>`);
                }
            } else if (isLWMW) {
                actionBtns.push(`<a href="https://www.mwlist.org/mwlist_quick_and_easy.php?area=1&kHz=${freqNum * 1000}" target="_blank"><button style="${btnStyle}">Mw-f</button></a>`);
                actionBtns.push(`<a href="https://www.mwlist.org/" target="_blank"><button style="${btnStyle}">Mw-h</button></a>`);
            } else if (isSW) {
                actionBtns.push(`<a href="https://www.short-wave.info/index.php?freq=${freqNum * 1000}" target="_blank"><button style="${btnStyle}">Sw-i</button></a>`);
            }

            const buttonsHtml = actionBtns.length > 0 
                ? `<div style="display:flex; gap:2px; flex-shrink:0;">${actionBtns.join('')}</div>` 
                : '';

            return `
            <div class="station-row" style="display:flex; align-items:center; gap:8px; margin-bottom: 4px; padding-bottom: 2px; border-bottom: 1px dotted #444;">
                <div class="tune-action" data-freq="${item.freq}" style="font-size:12px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-grow:1;" title="Sintonizza ${item.freq} MHz">${cleanNote}</div>
                ${buttonsHtml}
            </div>`;
        }).join('');
        mainPanel.innerHTML = header + list;

        // Attach events
        const menuBtn = mainPanel.querySelector('#ls-menu-btn');
        const dropdown = mainPanel.querySelector('#ls-dropdown-menu');

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                const closeMenu = () => { dropdown.style.display = 'none'; document.removeEventListener('click', closeMenu); };
                document.addEventListener('click', closeMenu);
            }
        };

        dropdown.querySelectorAll('.ls-dropdown-item').forEach(item => {
            item.onmouseover = () => item.style.backgroundColor = '#444';
            item.onmouseout = () => item.style.backgroundColor = 'transparent';
            item.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                const action = item.dataset.action;
                if (action === 'import-csv') { openManager(); setTimeout(() => document.getElementById('importCsvBtn')?.click(), 100); }
                else if (action === 'export-json') { exportDatabaseJson(); } 
                else if (action === 'show-data') { openManager(); setTimeout(() => document.getElementById('showTableBtn')?.click(), 100); }
                else if (action === 'info') { showUploadedFileInfo(); }
            };
        });

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
        mainPanel.querySelectorAll('.tune-action').forEach(div => {
            div.onclick = () => {
                const tuneFreq = parseFloat(div.dataset.freq);
                if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                    window.socket.send('T' + Math.round(tuneFreq * 1000));
                } else {
                    sendToast('error', pluginName, "Errore: WebSocket non connesso.");
                }
            };
        });
      } else {
        mainPanel.style.display = "none";
      }
    }

    const rawNotes = stationData.map(d => d.formatted);

    // crea un contenitore dedicato
    // dove poi mettere l'icona
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

    // svuola il contenitore e quindi rimuove icona precedente
    pluginBox.innerHTML = "";

    // Crea icona delle note
    const icon = document.createElement("i");

    // posizione e stile dell'icona (prima era 18px)
    icon.style.fontSize = "22px";
    icon.style.cursor = "pointer";
    icon.style.color = "var(--color-5)";
    icon.style.lineHeight = "1";
    // vecchia versione
    //icon.style.position = 'absolute';
    //icon.style.fontSize = '18px';
    //icon.style.opacity = '0.5';

    // Controlla se ci sono stazioni per quella frequenza
    if (rawNotes && rawNotes.length > 0) {
      // ✅ CI SONO NOTE
      icon.className = "fa-solid fa-radio";
      icon.style.opacity = "0.8";
      icon.title = Array.isArray(rawNotes) ? rawNotes.join("\n") : rawNotes;
      icon.onclick = () => openManager(f);
    } else {
      // ❌ NESSUNA NOTA
      icon.className = "fa-solid fa-circle";
      icon.style.opacity = "0.5";
      icon.title = "No data for this frequency";
      icon.onclick = () => openManager(f);
    }

    // aggiunge l'icona al contenitore
    pluginBox.appendChild(icon);
  }

  // ==============================
  // STATION MANAGER POPUP
  // ==============================
  function openManager() {
    // se il popup è già aperto, lo chiude (permette di chiudere cliccando di nuovo sull'icona)
    const existingPopup = document.getElementById("LoggedStationsPopup");
    if (existingPopup) {
      closePopup();
      return;
    }

    // conta totale delle stazioni
    const totalRecords = Object.values(notesMap).reduce((sum, arr) => {
        const records = Array.isArray(arr) ? arr : [arr];
        return sum + records.length;
    }, 0);

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
            <button title="View FM logbook map on fmlist.org" style="padding:4px 8px; font-size:12px;">FM Visual Logbook</button>
        </a>
        <a href="https://www.fmlist.org/ul_frameset.php?" target="_blank">
            <button title="Open fmlist.org main page (login needed)" style="padding:4px 8px; font-size:12px;">fmlist</button>
        </a>
        <a href="https://www.fmlist.org/fi_bandscan.php" target="_blank">
            <button title="Open fmlist.org bandscan tool (login needed)" style="padding:4px 8px; font-size:12px;">fmlist bandscan</button>
        </a>

        <a href="https://highpoint.fmdx.org/webtools/sporadic-e-monitor.html" target="_blank">
            <button title="Highpoint's Es Monitor" style="padding:4px 8px; font-size:12px;">Es Monitor</button>
        </a>

        <a href="https://www.dxinfocentre.com/tropo_eur.html" target="_blank">
            <button title="View William Hepburn's Tropospheric Ducting Forecast" style="padding:4px 8px; font-size:12px;">Tropo Hepburn</button>
        </a>
        <a href="https://tropo.f5len.org/forecasts-for-europe/" target="_blank">
            <button title="View F5LEN Tropospheric Propagation Forecast" style="padding:4px 8px; font-size:12px;">Tropo f5len</button>
        </a>

        <a href="https://dxrobot.gooddx.net/" target="_blank">
            <button title="View DX Robot real-time spots" style="padding:4px 8px; font-size:12px;">gooddx.net</button>
        </a>
        <a href="https://www.dxmaps.com/spots/mapg.php?Lan=E" target="_blank">
            <button title="View DXMaps real-time propagation maps" style="padding:4px 8px; font-size:12px;">dxmaps</button>
        </a>
        ` : ''}

        ${(freq !== null && freq < 50 && freq >= 2.3) ? `
        <a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank">
            <button title="View SW (login needed)" style="padding:4px 8px; font-size:12px;">SWk</button>
        </a>
        ` : ''}

        ${(freq !== null && freq < 50 && freq <= 2.3) ? `
        <a href="https://www.mwlist.org/mw_logmap.php?sort=&datum=0&hours=86400&band=ALL&rxin=Eur" target="_blank">
            <button title="View MW logbook map on mwlist.org (login needed)" style="padding:4px 8px; font-size:12px;">MW Visual Logbook</button>
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

      const names = new Set();
      serverFiles.forEach((f) => {
        if (f && f.name) names.add(f.name);
      });
      Object.keys(localStore).forEach((n) => names.add(n));

      if (names.size === 0) {
        info.textContent = "(uploaded files: none)";
        return;
      }

      const displayNames = [];
      const tooltipLines = [];

      names.forEach((name) => {
        const serverObj = serverFiles.find((f) => f && f.name === name);
        const localMtime = localStore[name] || null;
        const serverMtime =
          serverObj && serverObj.mtimeMs ? serverObj.mtimeMs : null;
        const mtime = serverMtime || localMtime;
        const src = serverObj && serverObj.uploaded ? "server" : "local";
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
            <li data-freq="${r.freq}" style="padding: 8px 0; cursor: pointer; ${!isLast ? 'border-bottom: 1px solid #444;' : ''}" title="Sintonizza ${r.freq} MHz">
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

    const names = new Set();
    serverFiles.forEach((f) => { if (f && f.name) names.add(f.name); });
    Object.keys(localStore).forEach((n) => names.add(n));

    let html = "<h3>Dettagli File Caricati</h3>";
    if (names.size === 0) {
      html += "<p style='margin-top:10px;'>Nessun file caricato nel database locale o presente sul server.</p>";
    } else {
      html += '<ul style="list-style:none; padding:0; font-size:13px; margin-top:15px; border-top:1px solid #444;">';
      names.forEach((name) => {
        const serverObj = serverFiles.find((f) => f && f.name === name);
        const localMtime = localStore[name] || null;
        const serverMtime = serverObj && serverObj.mtimeMs ? serverObj.mtimeMs : null;
        const mtime = serverMtime || localMtime;
        const src = serverObj && serverObj.uploaded ? "server" : "local";
        const date = mtime ? new Date(mtime).toLocaleString() : "data sconosciuta";
        html += `<li style="padding: 10px 0; border-bottom: 1px solid #444;">
                  <div style="font-weight: bold; color: var(--color-5);">${name}</div>
                  <div style="font-size: 0.9em; color: #ccc; margin-top:4px;">
                    Data: ${date} <br>
                    Origine: ${src}
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

    // ottiene tutte le frequenze ordinate numericamente, applica filtro se in singleFreqMode
    function getFreqs() {
      let freqs = Object.keys(notesMap).sort(
        (a, b) => parseFloat(a) - parseFloat(b)
      );

      // se siamo in singleFreqMode, filtriamo per frequenze vicine a onlyFreq (considerando tolleranza di 50 kHz per FM e 5 kHz per MW/LW)
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

    // normalizza i record per una frequenza: se è un array, lo appiattisce, se è una stringa lo trasforma in array, se non ci sono dati restituisce un array con un messaggio di default
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

    // renderizza la pagina corrente della tabella, con azioni e pulsanti di navigazione
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
                            <a href="${mapsUrlPi}" target="_blank"><button title="Show station on maps.fmdx.org (PI)">maps.fmdx</button></a>
                            <a href="${mapsUrlFreq}" target="_blank"><button title="Show frequency on maps.fmdx.org">${freq}</button></a>
                            <a href="${mapsUrlFmscan}" target="_blank"><button title="Show frequency on fmscan.org">fmscan</button></a>
                            <a href="${mapsUrlFmstream}" target="_blank"><button title="Listen on fmstream.org">fmstream</button></a>
                            
                            <button class="fmlist-log-btn" data-freq="${freq}" data-pi="${piCode}" data-ps="${name}" data-sid="${fmlistId}" data-dist="${qrb}" data-itu="${itu}" title="Automated log on fmlist.org">Log FMLIST</button>

                            ${piCode ? `<a href="#"><button class="pi-search-btn" data-pi="${piCode}" data-freq="${freq}" title="Cerca Frequenze Alternative (AF)">AF</button></a>` : ''}

                        `
                            : ""
                        }

                        ${
                          isLWMW
                            ? `
                            <a href="${mapsUrlMwlist}" target="_blank"><button title="Show frequency on mwlist.org">Mwlist freq</button></a>
                            <a href="${mapsUrlMwlist2}" target="_blank"><button title="mwlist.org (homepage)">Mwlist homepage</button></a>

                        `
                            : ""
                        }

                        ${
                          isSW
                            ? `
                            <a href="${mapsUrlSwinfo}" target="_blank"><button title="Show frequency on short-wave.info">Sw-info</button></a>
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
                ? `<input type="text" id="filterInput" placeholder="Filter by frequency or note..."
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
  // TRASFORMA QTF IN DIREZIONE
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
  // keeps track of already imported CSV files, to avoid duplicates
  function loadUploadedStore() {
    try {
      return JSON.parse(
        localStorage.getItem("LoggedStationsUploadedFiles") || localStorage.getItem("BandscanLogUploadedFiles") || "{}"
      );
    } catch (e) {
      return {};
    }
  }

  // salva lo stato dei file importati
  function saveUploadedStore(store) {
    try {
      localStorage.setItem("LoggedStationsUploadedFiles", JSON.stringify(store));
    } catch (e) {
      console.error("Error saving uploaded store", e);
    }
  }

  // controlla se un file è già stato importato localmente
  function isAlreadyUploadedLocal(name, mtimeMs) {
    const store = loadUploadedStore();
    return store[name] && store[name] === mtimeMs;
  }

  // segna un file come importato
  async function markFileUploaded(name, mtimeMs) {
    // save locally
    const store = loadUploadedStore();
    store[name] = mtimeMs;
    saveUploadedStore(store);

    console.log(
      `[${pluginName}] Marked local uploaded: ${name} (mtime:${mtimeMs})`
    );
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

  // scarica un file CSV dal server e lo importa
  async function getServerFiles() {
    try {
      const res = await fetch("/plugins/LoggedStations/files");
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    } catch (e) {
      return [];
    }
  }

  // scarica e importa un file CSV dal server
  function isAlreadyUploadedServer(serverList, name, mtimeMs) {
    if (!Array.isArray(serverList)) return false;
    const found = serverList.find(
      (f) => f && f.name === name && f.mtimeMs === mtimeMs
    );
    return !!found;
  }

  // scarica e importa un file CSV dal server
  function importFromCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    let rowsProcessed = 0;

    // cerca l'intestazione con MHz o kHz, per verificare che sia un CSV valido
    const headerLineIndex = lines.findIndex((line) => {
      const l = line.toLowerCase();
      return l.includes("mhz") || l.includes("khz");
    });

    // se non trova khz o mhz, esce
    if (headerLineIndex === -1) {
      sendToast('error', pluginName, "CSV file does not contain MHz or kHz header.");
      return;
    }

    // legge la linea delle intestazioni della tabella (con i nomi delle colonne)
    const headers = lines[headerLineIndex]
      .split(";")
      .map((h) => h.trim().toLowerCase());

    // mappa gli indici delle colonne rilevanti
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

    // verifica che ci sia almeno Program e MHz o kHz
    if (idxProgram === -1 || (idxMHz === -1 && idxKHz === -1)) {
      sendToast('error', pluginName, "CSV must contain Program and MHz or kHz columns.");
      return;
    }

    // Chiede all'utente se vuole aggiungere o sostituire
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

    // funzione locale: converte stringa frequenza in numero
    // gestisce anche formati con spazi dopo i mhz e virgole come separatore decimale
    function parseFrequency(value) {
      if (!value) return NaN;
      let str = value
        .toString()
        .replace(/mhz|khz/gi, "") // rimuove unità
        .replace(/\s+/g, "") // rimuove tutti gli spazi
        .replace(",", "."); // converte la virgola in punto
      const freq = parseFloat(str);
      return isNaN(freq) ? NaN : freq;
    }

    // processa le righe successive all'intestazione, che contengono i dati
    lines.slice(headerLineIndex + 1).forEach((line) => {
      // salta righe vuote
      if (!line.trim()) return;
      rowsProcessed++;

      // divide la riga in colonne
      const cols = line.split(";");

      // legge la frequenza
      let freq = parseFrequency(cols[isKHz ? idxKHz : idxMHz]);
      // salta se non è un numero valido
      if (isNaN(freq)) return;

      // converte in MHz se necessario
      if (isKHz) freq = freq / 1000;

      const noteParts = [];

      // Frequenza + programma
      let firstPart = `${freq.toFixed(3)}`;
      if (idxProgram !== -1) firstPart += ` ${cols[idxProgram]?.trim()}`; // solo spazio
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

      // unisce le parti della nota aggiungendo " – " come separatore
      const finalNote = noteParts.filter(Boolean).join(" – ");
      // usa il campo "Date" della riga se presente; se non presente non aggiunge nulla
      let finalNoteWithDate = finalNote;
      if (idxDate !== -1 && cols[idxDate] && cols[idxDate].trim()) {
        finalNoteWithDate = `${finalNote} (${cols[idxDate].trim()})`;
      }

      // Chiave sempre 3 decimali
      const freqKey = freq.toFixed(3);

      // aggiunge la nota (con metadata)
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

    // Deduplica i record importati: per ogni freq+station scegli la riga con date più recente
    const selectedNotes = {};
    for (const freq in newNotes) {
      const entries = newNotes[freq];
      const byStation = {};
      entries.forEach((ent) => {
        const key = (ent.station || "").toLowerCase();
        if (!byStation[key]) byStation[key] = ent;
        else {
          const a = byStation[key];
          // preferisci ent con date più recenti
          if ((ent.dateTs || 0) > (a.dateTs || 0)) byStation[key] = ent;
        }
      });
      selectedNotes[freq] = Object.values(byStation).map((e) => e.note);
    }

    // unisce o sostituisce le note esistenti
    if (addToExisting) {
      // unisce con notesMap esistente ma evita duplicati per station+freq
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
      // sostituisce completamente con i record selezionati
      const newMap = {};
      for (const freq in selectedNotes) newMap[freq] = selectedNotes[freq];
      notesMap = newMap;
    }

    // statistiche import
    const freqCount = Object.keys(newNotes).length;
    const recordCount = Object.values(newNotes).reduce(
      (s, arr) => s + (Array.isArray(arr) ? arr.length : 0),
      0
    );
    console.log(
      `[${pluginName}] Imported ${recordCount} records across ${freqCount} frequencies (processed ${rowsProcessed} CSV rows)`
    );

    saveNotes();
    sendToast('success', pluginName, `Imported ${freqCount} frequencies from CSV`, true);
    openManager();
  }

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

      // evita duplicati
      if (document.getElementById(BTN_ID)) return;

      // funzione plugin non ancora pronta
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

      // crea bottone
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
  // CONTROLLA SE CI SONO BANDSCAN SUL SERVER
  // ==============================
  async function checkServerCSVFiles() {
    try {
      const response = await fetch("/plugins/LoggedStations/files");
      if (!response.ok) return;

      const csvFiles = await response.json();
      if (!Array.isArray(csvFiles) || csvFiles.length === 0) return;

      // prima di scaricare, se non ci sono record locali svuota i marker per permettere re-import
      if (Object.keys(notesMap).length === 0) {
        try {
          const localStore = loadUploadedStore();
          const localNames = Object.keys(localStore);
          if (localNames.length > 0 || csvFiles.some((f) => f && f.uploaded)) {
            console.log(
              `[${pluginName}] No local records found — clearing uploaded markers (${localNames.length} local)`
            );
            // cancella store locale
            saveUploadedStore({});
            // notifica server per i file marcati
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

      // ⚠️ segnala che l'import viene dal server
      isServerImport = true;

      for (const fileObj of csvFiles) {
        const name = fileObj && fileObj.name ? fileObj.name : fileObj;
        const mtime = fileObj && fileObj.mtimeMs ? fileObj.mtimeMs : null;

        // se il server ha già segnato il file come 'uploaded' salta (log)
        if (fileObj && fileObj.uploaded && mtime) {
          console.log(
            `[${pluginName}] Server file marked uploaded, skipping: ${name} (mtime:${mtime})`
          );
          continue;
        }

        // salta se già importato localmente (stesso nome+data) e logga
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
  // SCARICA I DATI DAL SERVER
  // ==============================
  // funzione per scaricare ed importare un CSV usando importFromCSV
  function downloadCSVFile(fileName, mtime = null) {
    fetch(`/plugins/LoggedStations/files/${encodeURIComponent(fileName)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to download ${fileName}`);
        return response.text();
      })
      .then((csvText) => {
        console.log(`[${pluginName}] Downloaded CSV file: ${fileName}`);
        isServerImport = true; // flag per import server
        importFromCSV(csvText);
        // marca come importato localmente e notifica il server
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
    // crea un backdrop per chiudere il popup cliccando all'esterno
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
    popup.style.width = "70%"; // allargato al 70% della finestra
    popup.style.maxWidth = "1200px"; // limite massimo
    popup.style.maxHeight = "85vh"; // altezza massima
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
        <button onclick="document.getElementById('LoggedStationsSecondPopup').remove()" style="padding:4px 8px; font-size:12px; margin-top: 10px;">Chiudi</button>`;
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
