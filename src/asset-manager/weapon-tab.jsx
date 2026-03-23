import { For } from 'solid-js';
import { WeaponPreviewPanel } from './weapon-preview-panel.jsx';

const AXES = ['X', 'Y', 'Z'];

function VectorFields(props) {
  return (
    <For each={AXES}>
      {(axis, index) => (
        <label class="field">
          <span>{props.label} {axis}</span>
          <input
            type="number"
            step="0.001"
            value={props.values?.[index()] ?? 0}
            onInput={(event) => props.onInput(index(), event.currentTarget.value)}
          />
        </label>
      )}
    </For>
  );
}

export function WeaponTab(props) {
  return (
    <main class="asset-grid">
      <aside class="asset-sidebar panel">
        <div class="panel-header">
          <div>
            <p class="panel-label">Weapons</p>
            <h2>{props.weaponLibrary.length} configured</h2>
          </div>
          <button type="button" class="ghost-button" onClick={props.onCreateWeapon} disabled={props.busy}>
            New
          </button>
        </div>

        <div class="vehicle-list">
          <For each={props.weaponLibrary}>
            {(weapon) => (
              <button
                type="button"
                class={`vehicle-list-item${props.selectedWeaponId === weapon.id ? ' is-active' : ''}`}
                onClick={() => props.onSelectWeapon(weapon)}
              >
                <span class="vehicle-title">{weapon.label}</span>
                <span class="vehicle-meta">{weapon.id}</span>
                <span class="vehicle-meta">
                  {weapon.asset?.sourceLabel || weapon.proceduralModel || 'No model source'}
                </span>
              </button>
            )}
          </For>
        </div>
      </aside>

      <section class="panel asset-form-panel">
        <div class="panel-header">
          <div>
            <p class="panel-label">Weapon Record</p>
            <h2>{props.weaponDraft.label || 'New weapon'}</h2>
          </div>
          <div class="asset-inline-actions">
            <button type="button" class="ghost-button" onClick={props.onCreateWeapon} disabled={props.busy}>
              Reset
            </button>
            <button type="button" class="danger-button" onClick={props.onDeleteWeapon} disabled={props.busy || !props.weaponDraft.id}>
              Delete
            </button>
          </div>
        </div>

        <section class="subpanel">
          <div class="subpanel-header">
            <h3>Record</h3>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>ID</span>
              <input value={props.weaponDraft.id} onInput={(event) => props.onUpdateField(['id'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Label</span>
              <input value={props.weaponDraft.label} onInput={(event) => props.onUpdateField(['label'], event.currentTarget.value)} />
            </label>
            <label class="field field-wide">
              <span>Notes</span>
              <textarea
                class="field-textarea"
                value={props.weaponDraft.notes || ''}
                onInput={(event) => props.onUpdateField(['notes'], event.currentTarget.value)}
              />
            </label>
          </div>
        </section>

        <section class="subpanel">
          <div class="subpanel-header">
            <h3>Presentation</h3>
            <div class="asset-inline-actions">
              <button
                type="button"
                class="ghost-button"
                onClick={props.onOpenImportDialog}
                disabled={props.busy || props.presentationMode !== 'asset'}
              >
                Import GLB
              </button>
            </div>
          </div>
          <input
            ref={props.setImportInputRef}
            class="hidden-file-input"
            type="file"
            accept=".glb"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void props.onImportWeaponFile(file);
              }
            }}
          />
          <div class="field-grid">
            <label class="field field-wide">
              <span>Source Type</span>
              <select
                class="field-select"
                value={props.presentationMode}
                onChange={(event) => props.onSetPresentationMode(event.currentTarget.value)}
              >
                <option value="asset">GLB asset</option>
                <option value="procedural">Procedural</option>
              </select>
            </label>
            <label class="field field-wide">
              <span>Asset URL</span>
              <input
                value={props.weaponDraft.asset?.url || ''}
                disabled={props.presentationMode !== 'asset'}
                onInput={(event) => props.onUpdateField(['asset', 'url'], event.currentTarget.value)}
              />
            </label>
            <label class="field field-wide">
              <span>Asset Source Label</span>
              <input
                value={props.weaponDraft.asset?.sourceLabel || ''}
                disabled={props.presentationMode !== 'asset'}
                onInput={(event) => props.onUpdateField(['asset', 'sourceLabel'], event.currentTarget.value)}
              />
            </label>
            <label class="field field-wide">
              <span>Procedural Model</span>
              <input
                value={props.weaponDraft.proceduralModel || ''}
                disabled={props.presentationMode !== 'procedural'}
                onInput={(event) => props.onUpdateField(['proceduralModel'], event.currentTarget.value)}
              />
            </label>
          </div>
        </section>

        <section class="subpanel">
          <div class="subpanel-header">
            <h3>Grip Socket</h3>
          </div>
          <div class="field-grid">
            <VectorFields
              label="Grip Offset"
              values={props.weaponDraft.grip?.offset}
              onInput={(index, value) => props.onUpdateField(['grip', 'offset', index], value, { numeric: true })}
            />
            <VectorFields
              label="Grip Rotation"
              values={props.weaponDraft.grip?.rotation}
              onInput={(index, value) => props.onUpdateField(['grip', 'rotation', index], value, { numeric: true })}
            />
            <label class="field">
              <span>Grip Scale</span>
              <input
                type="number"
                step="0.001"
                value={props.weaponDraft.grip?.scale ?? 1}
                onInput={(event) => props.onUpdateField(['grip', 'scale'], event.currentTarget.value, { numeric: true })}
              />
            </label>
          </div>
        </section>

        <section class="subpanel">
          <div class="subpanel-header">
            <h3>Sockets</h3>
          </div>
          <div class="field-grid">
            <VectorFields
              label="Muzzle / Barrel"
              values={props.weaponDraft.sockets?.muzzle}
              onInput={(index, value) => props.onUpdateField(['sockets', 'muzzle', index], value, { numeric: true })}
            />
            <VectorFields
              label="Off Hand"
              values={props.weaponDraft.sockets?.offHand}
              onInput={(index, value) => props.onUpdateField(['sockets', 'offHand', index], value, { numeric: true })}
            />
            <VectorFields
              label="Casing Eject"
              values={props.weaponDraft.sockets?.casingEject}
              onInput={(index, value) => props.onUpdateField(['sockets', 'casingEject', index], value, { numeric: true })}
            />
            <VectorFields
              label="Aim"
              values={props.weaponDraft.sockets?.aim}
              onInput={(index, value) => props.onUpdateField(['sockets', 'aim', index], value, { numeric: true })}
            />
          </div>
        </section>

        <section class="subpanel">
          <div class="subpanel-header">
            <h3>Combat</h3>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Fire Cooldown Seconds</span>
              <input
                type="number"
                step="0.01"
                value={props.weaponDraft.combat?.fireCooldownSeconds ?? 0.12}
                onInput={(event) => props.onUpdateField(['combat', 'fireCooldownSeconds'], event.currentTarget.value, { numeric: true })}
              />
            </label>
          </div>
        </section>

        <section class="subpanel">
          <div class="subpanel-header">
            <h3>Locomotion Set</h3>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Idle</span>
              <input value={props.weaponDraft.locomotionSet?.idle || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'idle'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Walk</span>
              <input value={props.weaponDraft.locomotionSet?.walk || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'walk'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Run</span>
              <input value={props.weaponDraft.locomotionSet?.run || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'run'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Walk Backward</span>
              <input value={props.weaponDraft.locomotionSet?.walkBackward || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'walkBackward'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Run Backward</span>
              <input value={props.weaponDraft.locomotionSet?.runBackward || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'runBackward'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Strafe Left</span>
              <input value={props.weaponDraft.locomotionSet?.strafeLeft || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'strafeLeft'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Strafe Right</span>
              <input value={props.weaponDraft.locomotionSet?.strafeRight || ''} onInput={(event) => props.onUpdateField(['locomotionSet', 'strafeRight'], event.currentTarget.value)} />
            </label>
          </div>
        </section>
      </section>

      <aside class="panel asset-preview-panel">
        <div class="panel-header">
          <div>
            <p class="panel-label">Preview</p>
            <h2>Weapon Setup</h2>
          </div>
        </div>
        <WeaponPreviewPanel weaponDraft={props.weaponDraft} onUpdateField={props.onUpdateField} />
        <pre class="json-preview">{props.weaponJsonPreview}</pre>
        <div class="preview-footnote">
          Runtime source: <code>{props.weaponDraft.asset?.url || props.weaponDraft.proceduralModel || 'unset'}</code>
        </div>
      </aside>
    </main>
  );
}
