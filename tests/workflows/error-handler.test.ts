import { expect, test } from 'vitest';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

// The error alert's own language follows team_locale, through a generated Code node
// (src/nodes/error-alert.ts), the same pattern daily-summary's Render summary already uses. Load
// config's own output is always exactly { config } (AGENTS.md), so Shape alert input reads the
// Error Trigger's own fields back by name and pairs them with config.team_locale into the one flat
// item the Code node's run() expects.
test('Shape alert input combines the Error Trigger fields with team_locale', () => {
  const wf = workflowFile('error-handler.json');
  const shape = nodeOf(wf, 'Shape alert input');
  expect(shape.type).toBe('n8n-nodes-base.set');
  expect(sourcesOf(wf, 'Shape alert input', 0)).toEqual(['Load config']);

  const assignments = (shape.parameters.assignments as { assignments: { name: string; value: unknown }[] }).assignments;
  const byName = Object.fromEntries(assignments.map((a) => [a.name, a.value]));
  expect(byName.team_locale).toBe('={{ $json.config.team_locale }}');
  expect(byName.workflow_name).toBe("={{ $('Error Trigger').item.json.workflow.name }}");
  expect(byName.failed_node).toBe("={{ $('Error Trigger').item.json.execution.lastNodeExecuted }}");
  expect(byName.error_message).toBe("={{ $('Error Trigger').item.json.execution.error.message }}");
  expect(byName.execution_url).toBe("={{ $('Error Trigger').item.json.execution.url }}");
  expect(byName.time).toBe("={{ $now.setZone('America/Bogota').toFormat('yyyy-LL-dd HH:mm') }} America/Bogota");
});

test('Render error alert is the generated Code node from src/nodes/error-alert.ts', () => {
  const wf = workflowFile('error-handler.json');
  const render = nodeOf(wf, 'Render error alert');
  expect(render.type).toBe('n8n-nodes-base.code');
  expect(sourcesOf(wf, 'Render error alert', 0)).toEqual(['Shape alert input']);
  expect(String(render.parameters.jsCode)).toContain('Generated from src/nodes/error-alert.ts');
});

// Render error alert's own output is only { subject, message } - config.team_email doesn't survive
// it, so Email the team reads the address back off Load config by name, the same way daily-summary's
// Email summary reads $('Attach config to run').first().json.config.team_email.
test('Email the team sends the rendered subject and message as plain text, without n8n attribution', () => {
  const wf = workflowFile('error-handler.json');
  const email = nodeOf(wf, 'Email the team');
  expect(sourcesOf(wf, 'Email the team', 0)).toEqual(['Render error alert']);
  expect(email.parameters).toMatchObject({
    sendTo: "={{ $('Load config').first().json.config.team_email }}",
    subject: '={{ $json.subject }}',
    message: '={{ $json.message }}',
    emailType: 'text',
    options: { appendAttribution: false },
  });
});
