/* 跨日期原料關鍵字搜尋。瀏覽器與 node 測試共用。不記錄身分。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SearchModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SKIP_KEYS = {
    url: true,
    localPath: true,
    lookupToolUrl: true,
    ingredientPlatformUrl: true,
    additiveListUrl: true
  };

  function normalize(value) {
    return String(value ?? "")
      .replace(/\u3000/g, " ")
      .replace(/[\uFF01-\uFF5E]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokensOf(query) {
    const normalized = normalize(query);
    if (!normalized) return [];
    return normalized.split(" ").filter(Boolean);
  }

  function collectStrings(value, out) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) out.push(trimmed);
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item) { collectStrings(item, out); });
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach(function (key) {
      if (SKIP_KEYS[key]) return;
      collectStrings(value[key], out);
    });
  }

  function nameParts(ingredient) {
    const names = (ingredient && ingredient.names) || {};
    const parts = [
      ingredient && ingredient.id,
      names.commonZh,
      names.commonEn,
      names.trade,
      names.scientific
    ];
    ["aliases", "alias", "common"].forEach(function (key) {
      const value = names[key];
      if (typeof value === "string") parts.push(value);
      else if (Array.isArray(value)) {
        value.forEach(function (item) {
          if (typeof item === "string") parts.push(item);
        });
      }
    });
    return parts.filter(function (part) {
      return typeof part === "string" && part.trim();
    });
  }

  function buildIndex(days) {
    const entries = [];
    (Array.isArray(days) ? days : []).forEach(function (day) {
      const picks = Array.isArray(day && day.picks) ? day.picks : [];
      picks.forEach(function (ingredient) {
        if (!ingredient || typeof ingredient.id !== "string" || !ingredient.id) return;
        const lines = [];
        collectStrings(ingredient, lines);
        const names = nameParts(ingredient);
        entries.push({
          id: ingredient.id,
          date: typeof day.date === "string" ? day.date : "",
          label: (ingredient.names && ingredient.names.commonZh) || ingredient.id,
          hint: [
            ingredient.names && ingredient.names.commonEn,
            ingredient.names && ingredient.names.trade
          ].filter(function (part) { return typeof part === "string" && part.trim(); }).join(" · "),
          nameHay: normalize(names.join("\n")),
          nameLines: names.map(function (part) { return normalize(part); }),
          lines: lines
        });
      });
    });
    return entries;
  }

  function matchingLine(entry, tokens, mode) {
    const skip = new Set(entry.nameLines || []);
    let best = "";
    for (let i = 0; i < entry.lines.length; i += 1) {
      const line = entry.lines[i];
      const folded = normalize(line);
      if (!folded || skip.has(folded)) continue;
      const matched = mode === "every"
        ? tokens.every(function (token) { return folded.includes(token); })
        : tokens.some(function (token) { return folded.includes(token); });
      if (!matched) continue;
      if (!best || line.length < best.length) best = line;
    }
    return best;
  }

  function snippetFor(entry, tokens) {
    if (tokens.every(function (token) { return entry.nameHay.includes(token); })) return "";
    const line = matchingLine(entry, tokens, "every") || matchingLine(entry, tokens, "some");
    if (!line) return "";
    return line.length > 48 ? line.slice(0, 48) + "…" : line;
  }

  function scoreEntry(entry, tokens) {
    let score = 0;
    const lines = entry.nameLines || [];
    tokens.forEach(function (token) {
      score += 1;
      if (!lines.some(function (line) { return line.includes(token); })) return;
      score += 10;
      if (lines.some(function (line) { return line.startsWith(token); })) score += 3;
    });
    return score;
  }

  function search(index, query) {
    const tokens = tokensOf(query);
    if (!tokens.length) return [];
    const grouped = new Map();
    (index || []).forEach(function (entry, order) {
      const haystack = normalize(entry.lines.join("\n"));
      if (!tokens.every(function (token) { return haystack.includes(token); })) return;
      const score = scoreEntry(entry, tokens);
      const hit = { entry: entry, score: score, order: order };
      const prev = grouped.get(entry.id);
      if (!prev) grouped.set(entry.id, [hit]);
      else prev.push(hit);
    });
    const results = [];
    grouped.forEach(function (hits) {
      const best = hits.slice().sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? 1 : -1;
        return a.order - b.order;
      })[0];
      const dates = [];
      hits.forEach(function (hit) {
        if (hit.entry.date && dates.indexOf(hit.entry.date) === -1) dates.push(hit.entry.date);
      });
      dates.sort(function (a, b) {
        if (a === b) return 0;
        return a < b ? 1 : -1;
      });
      results.push({
        id: best.entry.id,
        date: best.entry.date,
        dates: dates,
        label: best.entry.label,
        hint: best.entry.hint,
        snippet: snippetFor(best.entry, tokens),
        score: best.score,
        order: best.order
      });
    });
    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.order - b.order;
    });
    return results;
  }

  return {
    normalize: normalize,
    tokensOf: tokensOf,
    buildIndex: buildIndex,
    search: search
  };
});
