import { bootstrapCourseForge } from './bootstrap/courseforge-bootstrap.js';

const result = await bootstrapCourseForge();

console.log('CourseForge skeleton + Otto wiring initialized');
console.log(`UI written to ${result.uiFilePath}`);
console.log(JSON.stringify({
  otto: result.otto.readiness,
  updates: result.otto.updateStatus,
  uiIndicators: result.ui.indicators
}, null, 2));