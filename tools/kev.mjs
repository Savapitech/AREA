const FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

const patterns = process.argv.slice(2).map(pattern => new RegExp(pattern, 'i'));

if (patterns.length === 0) {
  console.error('Usage: node tools/kev.mjs <regex on vendor or product>...');
  process.exit(1);
}

const response = await fetch(FEED);
if (!response.ok) {
  console.error(`Could not download ${FEED}: ${response.status}`);
  process.exit(1);
}

const catalog = await response.json();
console.log(`CISA KEV catalog ${catalog.catalogVersion}, ${catalog.count} entries\n`);

for (const pattern of patterns) {
  const matches = catalog.vulnerabilities.filter(entry => pattern.test(entry.vendorProject) || pattern.test(entry.product));
  console.log(`${pattern}: ${matches.length}`);
  for (const entry of matches.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))) {
    console.log(`  ${entry.dateAdded}  ${entry.cveID}  ${entry.vendorProject} / ${entry.product}`);
  }
}
