/**
 * v9.0.363 (TD-714): the domain event handlers the server registers at boot (`registerDomainEventHandlers`, server.ts),
 * run in a separate process so the test process's event bus stays free of them. Prints the action handlers registered.
 * Run by the test reg_boot_registers_no_demo_action_handlers_td_714.
 */
import { registerDomainEventHandlers } from '../../services/events/domainEventHandlers.js';
import { ActionHandlerService } from '../../services/events/actionHandlerService.js';

registerDomainEventHandlers();
const names = ActionHandlerService.getActionHandlerStats().handlers.map(h => h.handlerName);
console.log(`BOOT_HANDLERS_PROBE ${JSON.stringify({ actionHandlers: names })}`);
process.exit(0);
