/** Loaded as a data module. Values go only through the host's secret settings API. */
export const SETTINGS_EXTENSION = 'jev';
export const API_KEY_KEY = 'ext.jev.apiKey';
export const PRESELECT_KEY = 'ext.jev.preselectEnabled';

export function createComponent(React) {
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;
  return function JevSettings({ ctx }) {
    const host = ctx?.host;
    const [present, setPresent] = useState(undefined);
    const [enabled, setEnabled] = useState(undefined);
    const [draft, setDraft] = useState('');
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState('');
    const generation = useRef(0);
    const saving = useRef(false);
    useEffect(() => {
      const mine = ++generation.current;
      setPresent(undefined);
      setEnabled(undefined);
      setDraft('');
      setFailure('');
      setPending(false);
      saving.current = false;
      Promise.resolve().then(() => {
        if (!host?.getExtensionSettings) throw new Error('Settings are unavailable');
        return host.getExtensionSettings(SETTINGS_EXTENSION);
      }).then(values => {
        if (mine === generation.current) {
          setPresent(values?.[API_KEY_KEY] === true);
          setEnabled(values?.[PRESELECT_KEY] === true);
        }
      }).catch(() => {
        if (mine === generation.current) setFailure('Unable to load Jev settings. Reopen this section to retry.');
      });
      return () => { generation.current++; };
    }, [host]);

    async function save(value) {
      if (saving.current || present === undefined) return;
      const mine = ++generation.current;
      saving.current = true;
      setPending(true);
      setFailure('');
      try {
        if (!host?.updateExtensionSettings) throw new Error('Settings are unavailable');
        const reply = await host.updateExtensionSettings(SETTINGS_EXTENSION, { [API_KEY_KEY]: value });
        if (mine !== generation.current) return;
        if (!reply?.ok) {
          setFailure('The credential could not be saved. Check the key and try again.');
          return;
        }
        setPresent(value !== null);
        setDraft('');
      } catch {
        // Do not echo an arbitrary host/transport error that might contain the submitted key.
        if (mine === generation.current) setFailure('Unable to save Jev settings. Try again.');
      } finally {
        if (mine === generation.current) { saving.current = false; setPending(false); }
      }
    }

    async function saveEnabled(value) {
      if (saving.current || enabled === undefined) return;
      const mine = ++generation.current;
      saving.current = true;
      setPending(true);
      setFailure('');
      try {
        if (!host?.updateExtensionSettings) throw new Error('Settings are unavailable');
        const reply = await host.updateExtensionSettings(SETTINGS_EXTENSION, { [PRESELECT_KEY]: value });
        if (mine !== generation.current) return;
        if (!reply?.ok) {
          setFailure('The context preselection setting could not be saved. Try again.');
          return;
        }
        setEnabled(value);
      } catch {
        if (mine === generation.current) setFailure('Unable to save the context preselection setting. Try again.');
      } finally {
        if (mine === generation.current) { saving.current = false; setPending(false); }
      }
    }

    return h('div', { className: 'model-visibility' },
      h('p', null, 'One TypeSafe API key for all Jev features in PipiCOC.'),
      h('p', { role: 'status' }, present === undefined ? 'Loading…' : present ? 'Credential saved' : 'No credential saved'),
      h('form', { onSubmit: event => { event.preventDefault(); if (draft.trim()) void save(draft.trim()); } },
        h('label', null, 'TypeSafe API key', h('input', {
          type: 'password', autoComplete: 'off', spellCheck: false, value: draft,
          disabled: pending || present === undefined,
          onChange: event => setDraft(event.target.value),
          placeholder: present ? 'Enter a new key to replace the saved key' : '',
        })),
        h('button', { type: 'submit', disabled: pending || present === undefined || !draft.trim() }, 'Save'),
        h('button', { type: 'button', disabled: pending || !present, onClick: () => { void save(null); } }, 'Clear')),
      h('p', null, enabled === undefined ? 'Loading context preselection…'
        : enabled ? 'Context preselection enabled' : 'Context preselection disabled'),
      h('label', null, h('input', {
        type: 'checkbox', checked: enabled === true, disabled: pending || enabled === undefined,
        onChange: event => { void saveEnabled(event.target.checked); },
      }), 'Enable Jev context preselection'),
      failure ? h('p', { role: 'alert' }, failure) : null,
      h('p', null, 'The key is kept in the app vault. Existing sessions refresh at their next idle restart boundary; reopen the table to use it immediately.'),
    );
  };
}
