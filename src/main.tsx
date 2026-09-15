import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { InteractionLab } from './lab';
import { OnlyScreen, onlyScreenId } from './lab/only-screen';
import './index.css';

const host = document.getElementById('root');
if (!host) throw new Error('no #root to mount into');

/*
 * `?only=<id>` opens one screen at its real size, with no canvas around it.
 *
 * For an honest screenshot, or for measuring anything: on the canvas every
 * client rect is multiplied by the camera's scale, so a 24px control reads
 * 2.62px at fit-all. Here nothing is scaled and a rect means what it says.
 */
const only = onlyScreenId();

createRoot(host).render(
  <StrictMode>
    {only ? <OnlyScreen id={only} /> : <InteractionLab />}
  </StrictMode>,
);
