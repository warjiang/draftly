const STACK_RULES = `
You are editing an existing Draftly source project in the current working directory.
The project uses Vite, React, TypeScript, Tailwind CSS v4 and shadcn/ui.
Work directly in the source files. Do not return HTML or paste source code in your final response.
Use the existing dependencies and components before adding packages.
Keep the app responsive and accessible. Do not remove the Draftly inspect bridge from src/main.tsx
or the locator integration from vite.config.ts.
Run npm run build before finishing. Fix every error you introduce.
Your final response must briefly summarize the files changed.
`.trim();

export function buildGenerateInstruction({ userPrompt, designMd = null, variant = 1 }) {
  return [
    STACK_RULES,
    `Create a complete interface for this request:\n${userPrompt}`,
    `This is design variant ${variant}. Make the visual direction intentional and distinct.`,
    designMd
      ? 'A DESIGN.md file is present. Treat it as the binding visual design contract.'
      : 'Establish a coherent visual system in src/index.css and the React components.',
    'Replace the starter experience with the finished product. Use realistic copy in the user language.',
  ].join('\n\n');
}

export function buildIterateInstruction({ instruction }) {
  return [
    STACK_RULES,
    'Inspect the current application before editing it.',
    `Implement this user request:\n${instruction}`,
    'Preserve unrelated behavior and design decisions.',
  ].join('\n\n');
}

export function buildSourceEditInstruction({ instruction, context }) {
  return [
    STACK_RULES,
    'The user selected a rendered element that maps to the following source context:',
    context,
    `Implement this goal for the selected element:\n${instruction}`,
    'Locate the actual component in the project and make the smallest complete source change.',
  ].join('\n\n');
}

export function buildImageEditInstruction({ instruction }) {
  return [
    STACK_RULES,
    'A reference screenshot is attached to this task.',
    `Modify the current application to achieve this goal:\n${instruction}`,
    'Use the screenshot as visual evidence while preserving unrelated functionality.',
  ].join('\n\n');
}
