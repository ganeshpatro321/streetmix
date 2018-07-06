import { noop } from 'lodash'
import { undo, redo } from '../streets/undo_stack'
import { registerKeypress } from './keypress'
import { showStatusMessage } from './status_message'
import { t } from '../locales/locale'
import { showDialog } from '../store/actions/dialogs'
import store from '../store'

export const KEYS = {
  ENTER: 13,
  ESC: 27,
  EQUAL: 187, // = or +
  EQUAL_ALT: 61, // Firefox
  PLUS_KEYPAD: 107,
  MINUS: 189,
  MINUS_ALT: 173, // Firefox
  MINUS_KEYPAD: 109,
  BACKSPACE: 8,
  DELETE: 46
}

export function registerKeypresses () {
  // In case anyone tries a save shortcut key out of reflex,
  // we inform the user that it's not necessary.
  registerKeypress('ctrl s', {
    trackAction: 'Command-S or Ctrl-S save shortcut key pressed'
  }, function () {
    showStatusMessage(t('toast.no-save', 'No need to save by hand; Streetmix automatically saves your street!'))
  })

  // Catch-all for the Ctrl-S shortcut from ever trying to
  // save the page contents
  registerKeypress('ctrl s', {
    preventDefault: true,
    requireFocusOnBody: false
  }, noop)

  // Catch-all for the backspace or delete buttons to prevent
  // browsers from going back in history
  registerKeypress(['backspace', 'delete'], {
    preventDefault: true,
    requireFocusOnBody: true
  }, noop)

  // Secret menu to toggle feature flags
  registerKeypress('shift f', () => {
    store.dispatch(showDialog('FEATURE_FLAGS'))
  })

  // Undo
  registerKeypress('ctrl z', {
    preventDefault: true,
    requireFocusOnBody: true,
    shiftKey: false
  }, undo)

  // Redo
  registerKeypress(['shift ctrl z', 'ctrl y'], {
    preventDefault: true,
    requireFocusOnBody: true
  }, redo)
}
