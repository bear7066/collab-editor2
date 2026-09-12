import { routes } from '../../server/app.js';
import { vercelHandler } from '../../server/env.js';

export default vercelHandler(routes.logout);
