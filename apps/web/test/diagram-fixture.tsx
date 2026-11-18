// Development-only visual check of the production Diagram component.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Diagram} from '../src/pages/Knowledge';
export function mount(){
 const host=document.createElement('div');host.id='diagram-check';host.style.cssText='position:fixed;inset:0;background:white;z-index:99999;padding:32px;overflow:auto';document.body.append(host);
 createRoot(host).render(<Diagram source={'flowchart LR\n  Client --> API\n  API --> Database'}/>);
}
