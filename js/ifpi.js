/**
 * IFPI global chart references for TOTALCHART.
 *
 * IFPI's public pages are linked as the source of record. This module does
 * not copy or redistribute IFPI chart rankings or sales figures.
 */
const CHARTS_URL = "https://www.ifpi.org/our-industry/global-charts/";
const ALBUMS_2025_URL = "https://www.ifpi.org/taylor-swifts-the-life-of-a-showgirl-named-ifpis-official-biggest-selling-global-album-of-the-year-2025/";
const SINGLES_2025_URL = "https://www.ifpi.org/rose-and-bruno-mars-apt-crowned-ifpis-biggest-selling-global-single-of-the-year-2025/";
const ARTIST_2025_URL = "https://www.ifpi.org/taylor-swift-named-ifpis-official-biggest-selling-global-artist-of-the-year-for-a-sixth-time/";

const REFERENCES = {
  track: {
    heading: "IFPI Global Single Chart",
    summary: "IFPI's annual Global Single Chart covers single-track downloads and streaming across paid and ad-supported services. Its published chart metric is not a standalone paid-download count.",
    limitation: "This cannot be used as an exact digital-download sales total. The chart is an annual worldwide ranking, not a searchable lifetime-sales database.",
    links: [
      { label: "IFPI Global Charts", url: CHARTS_URL },
      { label: "2025 Global Single Chart methodology and results", url: SINGLES_2025_URL }
    ]
  },
  album: {
    heading: "IFPI Global Album Sales & Vinyl Charts",
    summary: "The Global Album Sales Chart counts physical album sales plus full-album downloads as units. The separate Global Vinyl Album Chart counts vinyl units only.",
    limitation: "The combined album-sales chart does not provide a public split between physical purchases and full-album downloads. IFPI's public charts are annual rankings, not an all-release lifetime-sales database.",
    links: [
      { label: "IFPI Global Charts", url: CHARTS_URL },
      { label: "2025 Global Album Sales and Vinyl results", url: ALBUMS_2025_URL }
    ]
  },
  artist: {
    heading: "IFPI Global Artist Chart",
    summary: "IFPI's annual Global Artist Chart considers an artist's catalogue across physical sales, downloads, and streaming worldwide.",
    limitation: "The chart is a global annual ranking; IFPI does not publish its underlying converted chart-unit totals as an artist lifetime-sales figure.",
    links: [
      { label: "IFPI Global Charts", url: CHARTS_URL },
      { label: "2025 Global Artist Chart results", url: ARTIST_2025_URL }
    ]
  }
};

export function getIfpiReference(entityType) {
  const reference = REFERENCES[entityType];
  if (!reference) return null;
  return {
    heading: reference.heading,
    summary: reference.summary,
    limitation: reference.limitation,
    links: reference.links.map(link => ({ ...link }))
  };
}
