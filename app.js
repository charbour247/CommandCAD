// --- DATA STATE ---
let units = [
    { id: "P-101", type: "Police", status: "AVAILABLE" },
    { id: "E-12", type: "Fire", status: "AVAILABLE" },
    { id: "MED-3", type: "EMS", status: "AVAILABLE" }
];

let calls = [];
let callCounter = 100;
const storageKey = 'commandcad-state-v1';
let storageWarningShown = false;
let editingUnitId = null;
const unitStatuses = {
    AVAILABLE: 'Available',
    DISPATCHED: 'Dispatched',
    EN_ROUTE: 'En Route',
    ON_SCENE: 'On Scene',
    TRANSPORTING: 'Transporting'
};

function changeUnitStatus(unitId, status) {
    const unit = units.find(u => u.id === unitId);
    if (!unit || !Object.hasOwn(unitStatuses, status) || unit.status === status) return;
    const previousStatus = unit.status;
    const time = getMilitaryTime();
    const stage = { DISPATCHED: 'dispatched', EN_ROUTE: 'enroute', ON_SCENE: 'onScene', TRANSPORTING: 'transport' }[status];
    calls.filter(call => call.status !== 'CLOSED' && call.assignedUnits.includes(unitId)).forEach(call => {
        call.notes.push({ time, text: `Unit ${unitId}: ${unitStatuses[previousStatus]} → ${unitStatuses[status]}.` });
        if (stage && !call.timestamps[stage]) call.timestamps[stage] = time;
        if (status === 'AVAILABLE') {
            call.assignedUnits = call.assignedUnits.filter(id => id !== unitId);
            call.notes.push({ time, text: `Unit ${unitId} cleared from incident.` });
        }
    });
    unit.status = status;
    saveState();
    renderUnits();
    renderCalls();
}

window.changeIncidentUnitStatus = function(callId, status) {
    const call = calls.find(c => c.id === callId);
    const unitId = document.getElementById(`status-unit-${callId}`)?.value;
    if (!call || call.status === 'CLOSED') return;
    if (!unitId || !call.assignedUnits.includes(unitId)) {
        alert('Select an assigned unit to change its status.');
        return;
    }
    changeUnitStatus(unitId, status);
};

function removeUnit(unitId) {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    if (unit.status !== 'AVAILABLE' || calls.some(call =>
        call.status !== 'CLOSED' && call.assignedUnits.includes(unitId))) {
        alert('Clear this unit from its active incident before removing it.');
        return;
    }
    units = units.filter(u => u !== unit);
    if (editingUnitId === unitId) {
        document.getElementById('editUnitDialog').close();
        editingUnitId = null;
    }
    saveState();
    renderUnits();
    renderCalls();
}

function editUnit(unitId) {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    editingUnitId = unitId;
    document.getElementById('editUnitId').value = unit.id;
    document.getElementById('editUnitType').value = unit.type;
    document.getElementById('editUnitDialog').showModal();
}

function handleEditUnit(event) {
    event.preventDefault();
    const unit = units.find(u => u.id === editingUnitId);
    if (!unit) return;
    const id = document.getElementById('editUnitId').value.trim();
    const type = document.getElementById('editUnitType').value;
    if (!id || units.some(u => u !== unit && u.id.toLowerCase() === id.toLowerCase())) {
        alert('Enter a nonblank, unique unit ID.');
        return;
    }
    if (!['Police', 'Fire', 'EMS'].includes(type)) return;
    const oldId = unit.id;
    if (oldId !== id || unit.type !== type) {
        calls.forEach(call => {
            // Closed incidents retain the unit ID recorded at the time.
            if (call.status === 'CLOSED' || !call.assignedUnits.includes(oldId)) return;
            call.assignedUnits = call.assignedUnits.map(assigned => assigned === oldId ? id : assigned);
            call.notes.push({ time: getMilitaryTime(), text: `Unit updated: ${oldId} (${unit.type}) → ${id} (${type}).` });
        });
        unit.id = id;
        unit.type = type;
        saveState();
        renderUnits();
        renderCalls();
    }
    document.getElementById('editUnitDialog').close();
    editingUnitId = null;
}

function saveState() {
    try {
        localStorage.setItem(storageKey, JSON.stringify({ units, calls, callCounter }));
    } catch (error) {
        if (!storageWarningShown) {
            alert('Local saving is unavailable. Export calls before closing this page.');
            storageWarningShown = true;
        }
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const saved = JSON.parse(raw);
        const string = value => typeof value === 'string';
        if (!Array.isArray(saved.units) || !Array.isArray(saved.calls) ||
            !Number.isSafeInteger(saved.callCounter) || saved.callCounter < 100 ||
            !saved.units.every(u => u && string(u.id) && string(u.type) &&
                ['AVAILABLE', 'DISPATCHED', 'EN_ROUTE', 'ON_SCENE', 'TRANSPORTING'].includes(u.status)) ||
            !saved.calls.every(c => c && /^CAD-\d+$/.test(c.id) && string(c.type) && string(c.location) &&
                ['Low', 'Medium', 'High'].includes(c.priority) && ['OPEN', 'CLOSED'].includes(c.status) &&
                Array.isArray(c.assignedUnits) && c.assignedUnits.every(id => string(id) &&
                    (c.status === 'CLOSED' || saved.units.some(u => u.id === id))) &&
                Array.isArray(c.notes) && c.notes.every(n => n && string(n.time) && string(n.text)) &&
                c.timestamps && ['created', 'dispatched', 'enroute', 'onScene', 'cleared'].every(k =>
                    c.timestamps[k] === null || string(c.timestamps[k])))) {
            throw new Error('Invalid saved data');
        }
        units = saved.units;
        calls = saved.calls;
        calls.forEach(call => { call.timestamps.transport ??= null; });
        callCounter = Math.max(saved.callCounter, ...calls.map(c => Number(c.id.slice(4))));
    } catch (error) {
        alert('Saved data could not be loaded. Local saving is disabled to protect existing records.');
        // Do not overwrite a damaged or inaccessible saved session.
        saveState = () => {};
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

// --- UTILITIES ---
function getMilitaryTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function updateClock() {
    document.getElementById('militaryClock').innerText = `${getMilitaryTime()} HRS`;
}

// --- EVENT HANDLERS ---
function handleAddUnit(e) {
    e.preventDefault();
    const id = document.getElementById('unitIdInput').value.trim();
    const type = document.getElementById('unitTypeInput').value;

    if (id && !units.some(u => u.id.toLowerCase() === id.toLowerCase())) {
        units.push({ id, type, status: "AVAILABLE" });
        saveState();
        document.getElementById('unitIdInput').value = '';
        renderUnits();
        renderCalls(); // Re-render calls to update unit assignment dropdowns
    } else {
        alert("Unit ID must be unique!");
    }
}

function handleCreateCall(e) {
    e.preventDefault();
    const type = document.getElementById('callTypeInput').value.trim();
    const location = document.getElementById('callLocInput').value.trim();
    const priority = document.getElementById('callPriorityInput').value;

    if (!type || !location) {
        alert('Enter an incident type and location.');
        return;
    }

    callCounter++;
    const newCall = {
        id: `CAD-${callCounter}`,
        type,
        location,
        priority,
        status: "OPEN",
        assignedUnits: [],
        notes: [{ time: getMilitaryTime(), text: "Call created and logged." }],
        timestamps: {
            created: getMilitaryTime(),
            dispatched: null,
            enroute: null,
            onScene: null,
            transport: null,
            cleared: null
        }
    };

    calls.unshift(newCall);
    saveState();
    document.getElementById('callTypeInput').value = '';
    document.getElementById('callLocInput').value = '';
    renderCalls();
}

window.assignUnitToCall = function(callId, unitId) {
    if (!unitId) return;
    const call = calls.find(c => c.id === callId);
    const unit = units.find(u => u.id === unitId);

    if (call && call.status !== 'CLOSED' && unit && unit.status === 'AVAILABLE') {
        if (!call.assignedUnits.includes(unitId)) {
            call.assignedUnits.push(unitId);
            unit.status = "DISPATCHED";
            if (!call.timestamps.dispatched) {
                call.timestamps.dispatched = getMilitaryTime();
            }
            call.notes.push({ time: getMilitaryTime(), text: `Unit ${unitId} dispatched.` });
            saveState();
            renderUnits();
            renderCalls();
        }
    }
};

window.updateTimestamps = function(callId, stage) {
    const call = calls.find(c => c.id === callId);
    if (!call || call.status === 'CLOSED') return;
    if (!['enroute', 'onScene', 'transport', 'cleared'].includes(stage)) return;
    if (stage !== 'cleared' && !call.assignedUnits.length) return;

    const timeNow = getMilitaryTime();
    if (stage === 'enroute') {
        if (!call.assignedUnits.some(id => units.find(u => u.id === id)?.status === 'DISPATCHED')) return;
        if (!call.timestamps.enroute) call.timestamps.enroute = timeNow;
        call.assignedUnits.forEach(uId => {
            const u = units.find(x => x.id === uId);
            if (u && u.status === 'DISPATCHED') u.status = "EN_ROUTE";
        });
        call.notes.push({ time: timeNow, text: "Units en route." });
    } else if (stage === 'onScene') {
        if (!call.assignedUnits.some(id => ['DISPATCHED', 'EN_ROUTE'].includes(units.find(u => u.id === id)?.status))) return;
        if (!call.timestamps.onScene) call.timestamps.onScene = timeNow;
        call.assignedUnits.forEach(uId => {
            const u = units.find(x => x.id === uId);
            if (u && ['DISPATCHED', 'EN_ROUTE'].includes(u.status)) u.status = "ON_SCENE";
        });
        call.notes.push({ time: timeNow, text: "Units arrived on scene." });
    } else if (stage === 'transport') {
        const transportingUnits = units.filter(u => call.assignedUnits.includes(u.id) && u.status === 'ON_SCENE');
        if (!transportingUnits.length) {
            alert('Mark a unit On Scene before starting transport.');
            return;
        }
        if (!call.timestamps.transport) call.timestamps.transport = timeNow;
        transportingUnits.forEach(u => { u.status = 'TRANSPORTING'; });
        call.notes.push({ time: timeNow, text: `Units transporting: ${transportingUnits.map(u => u.id).join(', ')}.` });
    } else if (stage === 'cleared') {
        call.timestamps.cleared = timeNow;
        call.status = "CLOSED";
        call.assignedUnits.forEach(uId => {
            const u = units.find(x => x.id === uId);
            if (u) u.status = "AVAILABLE";
        });
        call.notes.push({ time: timeNow, text: "Call closed and units cleared." });
    }
    saveState();
    renderUnits();
    renderCalls();
};

window.addNoteToCall = function(callId) {
    const input = document.getElementById(`note-input-${callId}`);
    const call = calls.find(c => c.id === callId);
    if (!input || !call || call.status === 'CLOSED') return;
    const text = input.value.trim();
    if (text) {
        call.notes.push({ time: getMilitaryTime(), text });
        saveState();
        input.value = '';
        renderCalls();
    }
};

// --- EXPORT TO CSV ---
function exportCallsToCSV() {
    if (calls.length === 0) {
        alert("No calls available to export.");
        return;
    }

    const headers = ["Call ID", "Type", "Location", "Priority", "Status", "Units", "Created", "Dispatched", "EnRoute", "OnScene", "Transport", "Cleared", "Notes"];
    const csvCell = value => {
        let text = String(value ?? '');
        if (/^[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = calls.map(c => [
        c.id, c.type, c.location, c.priority, c.status, c.assignedUnits.join(', '),
        c.timestamps.created, c.timestamps.dispatched, c.timestamps.enroute,
        c.timestamps.onScene, c.timestamps.transport, c.timestamps.cleared,
        c.notes.map(n => `[${n.time}] ${n.text}`).join(' | ')
    ]);
    const csvContent = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const encodedUri = URL.createObjectURL(new Blob(['\uFEFF', csvContent], { type: 'text/csv;charset=utf-8;' }));

    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `cad_incident_export_${getMilitaryTime().replace(/:/g, '')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(encodedUri), 1000);
}

// --- RENDER FUNCTIONS ---
function renderUnits() {
    const container = document.getElementById('unitList');
    container.innerHTML = units.map(u => `
        <div class="unit-card ${u.status}">
            <div class="unit-id">${escapeHTML(u.id)}</div>
            <div class="unit-type">${escapeHTML(u.type)} • ${escapeHTML(u.status.replace('_', ' '))}</div>
            <button type="button" class="btn-action" data-edit-unit="${escapeHTML(u.id)}" aria-label="Edit unit ${escapeHTML(u.id)}">Edit</button>
            <button type="button" class="btn-action" data-remove-unit="${escapeHTML(u.id)}" aria-label="Remove unit ${escapeHTML(u.id)}">Remove</button>
        </div>
    `).join('');
    container.querySelectorAll('[data-edit-unit]').forEach(button => {
        button.addEventListener('click', () => editUnit(button.dataset.editUnit));
    });
    container.querySelectorAll('[data-remove-unit]').forEach(button => {
        button.addEventListener('click', () => removeUnit(button.dataset.removeUnit));
    });
}

function renderCalls() {
    const container = document.getElementById('callsList');
    const drafts = new Map(Array.from(container.querySelectorAll('input, select'), input => [input.id, input.value]));
    const focusedId = document.activeElement?.id;
    const selectionStart = document.activeElement?.selectionStart;
    const selectionEnd = document.activeElement?.selectionEnd;
    
    if (calls.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px;">No active incident calls.</div>`;
        return;
    }

    container.innerHTML = calls.map(c => {
        const availableUnitsOptions = units
            .filter(u => u.status === 'AVAILABLE')
            .map(u => `<option value="${escapeHTML(u.id)}">${escapeHTML(u.id)} (${escapeHTML(u.type)})</option>`)
            .join('');

        return `
        <div class="call-card" style="opacity: ${c.status === 'CLOSED' ? '0.6' : '1'}">
            <div class="call-header">
                <div>
                    <span class="call-title">${c.id}: ${escapeHTML(c.type)}</span>
                    <span class="badge badge-${escapeHTML(c.priority)}">${escapeHTML(c.priority)}</span>
                </div>
                <span class="badge" style="background-color: var(--border);">${escapeHTML(c.status)}</span>
            </div>
            
            <div class="call-location">📍 ${escapeHTML(c.location)}</div>

            <!-- Timestamps Box -->
            <div class="timestamps">
                <div class="ts-item">Created: <span>${escapeHTML(c.timestamps.created)}</span></div>
                <div class="ts-item">Disp: <span>${escapeHTML(c.timestamps.dispatched || '--:--')}</span></div>
                <div class="ts-item">Enroute: <span>${escapeHTML(c.timestamps.enroute || '--:--')}</span></div>
                <div class="ts-item">Scene: <span>${escapeHTML(c.timestamps.onScene || '--:--')}</span></div>
                <div class="ts-item">Transport: <span>${escapeHTML(c.timestamps.transport || '--:--')}</span></div>
                <div class="ts-item">Cleared: <span>${escapeHTML(c.timestamps.cleared || '--:--')}</span></div>
            </div>

            <!-- Assigned Units -->
            <div>
                <strong style="font-size: 0.85rem; color: var(--text-muted);">ASSIGNED UNITS:</strong>
                <div style="font-size: 0.95rem; margin-top: 4px;">
                    ${c.assignedUnits.length > 0 ? escapeHTML(c.assignedUnits.join(', ')) : 'None'}
                </div>
            </div>

            <!-- Call Actions & Status Management -->
            ${c.status !== 'CLOSED' ? `
            <div class="call-actions">
                <select id="assign-select-${c.id}" style="width: auto; flex-grow: 1;">
                    <option value="">-- Assign Available Unit --</option>
                    ${availableUnitsOptions}
                </select>
                <button class="btn-action" onclick="assignUnitToCall('${c.id}', document.getElementById('assign-select-${c.id}').value)">Assign</button>
            </div>
            <div class="call-actions">
                <select id="status-unit-${c.id}" aria-label="Unit to update for ${c.id}" style="width: auto; flex-grow: 1;">
                    <option value="">-- Select Assigned Unit --</option>
                    ${c.assignedUnits.map(id => {
                        const unit = units.find(u => u.id === id);
                        return unit ? `<option value="${escapeHTML(id)}">${escapeHTML(id)} (${escapeHTML(unitStatuses[unit.status])})</option>` : '';
                    }).join('')}
                </select>
                ${Object.entries(unitStatuses).map(([status, label]) => `<button class="btn-action" onclick="changeIncidentUnitStatus('${c.id}', '${status}')">${label}</button>`).join('')}
            </div>
            <div class="call-actions">
                <button class="btn-action" style="color: #EF4444;" onclick="updateTimestamps('${c.id}', 'cleared')">Clear Incident</button>
            </div>
            ` : ''}

            <!-- Notes Section -->
            <div class="notes-section">
                ${c.notes.map(n => `
                    <div class="note-entry">
                        <span class="note-time">[${escapeHTML(n.time)}]</span> ${escapeHTML(n.text)}
                    </div>
                `).join('')}
            </div>

            ${c.status !== 'CLOSED' ? `
            <div style="display: flex; gap: 8px;">
                <input type="text" id="note-input-${c.id}" placeholder="Add incident note..." style="flex-grow: 1;">
                <button class="btn-action" onclick="addNoteToCall('${c.id}')">Add Note</button>
            </div>
            ` : ''}
        </div>
    `}).join('');
    drafts.forEach((value, id) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });
    const focused = document.getElementById(focusedId);
    if (focused && container.contains(focused)) {
        focused.focus();
        if (focused.setSelectionRange && selectionStart != null) {
            focused.setSelectionRange(selectionStart, selectionEnd);
        }
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    document.getElementById('editUnitForm').addEventListener('submit', handleEditUnit);
    document.getElementById('cancelUnitEdit').addEventListener('click', () => {
        document.getElementById('editUnitDialog').close();
        editingUnitId = null;
    });
    // Attach Event Listeners
    document.getElementById('addUnitForm').addEventListener('submit', handleAddUnit);
    document.getElementById('addCallForm').addEventListener('submit', handleCreateCall);
    document.getElementById('exportBtn').addEventListener('click', exportCallsToCSV);

    // Start Clock
    setInterval(updateClock, 1000);
    updateClock();

    // Initial Render
    renderUnits();
    renderCalls();
});
