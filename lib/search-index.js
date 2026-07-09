/**
 * buildSearchIndex — Build-time search index generator.
 *
 * Iterates over all topics/sections, strips HTML from each section body,
 * and produces a flat array of records suitable for MiniSearch.
 *
 * Output: { records: SearchRecord[] }
 *
 * SearchRecord:
 *   id:          "${topicSlug}/${sectionId}"
 *   topicSlug:   string
 *   topicTitle:  string
 *   topicGroup:  string (nav group title)
 *   sectionId:   string
 *   sectionTitle: string
 *   body:        string (plain text, HTML tags stripped)
 */

function stripHtml(html) {
  return String(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c))
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} context
 * @param {object} context.site — parsed site.json (has `sections` array)
 * @param {object} context.topics — map of slug → { title, sections }
 * @returns {{ records: Array<object> }}
 */
export function buildSearchIndex({ site, topics }) {
  const records = [];

  // Build a map: topicSlug → nav group title
  const groupBySlug = new Map();
  for (const section of site.sections || []) {
    for (const topic of section.topics || []) {
      groupBySlug.set(topic.slug, section.title || "");
    }
  }

  for (const [slug, topic] of Object.entries(topics)) {
    const group = groupBySlug.get(slug) || "";
    // Build topic's group chain: just the immediate group for breadcrumb
    for (const sec of topic.sections) {
      const id = `${slug}/${sec.id}`;
      const body = stripHtml(sec.html || "");
      // Only index sections with meaningful body text
      if (body.length < 1) continue;

      records.push({
        id,
        topicSlug: slug,
        topicTitle: topic.title,
        topicGroup: group,
        sectionId: sec.id,
        sectionTitle: sec.title,
        body,
      });
    }
  }

  // Sort by id for deterministic order
  records.sort((a, b) => a.id.localeCompare(b.id));

  return { records };
}
