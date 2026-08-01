function normalizeProjectIdentity(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function draftActivityAt(draft) {
  return draft.versions?.at(-1)?.at || draft.createdAt || "";
}

export function groupDraftsByProject(drafts) {
  const groups = new Map();

  for (const draft of drafts) {
    const identity = normalizeProjectIdentity(draft.prompt) || normalizeProjectIdentity(draft.title) || draft.id;
    const existing = groups.get(identity) || [];
    existing.push(draft);
    groups.set(identity, existing);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const sorted = items.slice().sort((left, right) => (
        draftActivityAt(right).localeCompare(draftActivityAt(left))
      ));
      return {
        key,
        drafts: sorted,
        latest: sorted[0],
        revisionCount: sorted.length,
      };
    })
    .sort((left, right) => (
      draftActivityAt(right.latest).localeCompare(draftActivityAt(left.latest))
    ));
}
