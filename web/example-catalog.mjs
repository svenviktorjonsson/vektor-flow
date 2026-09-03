const search = document.querySelector("#example-search");
const tree = document.querySelector("#example-tree");
const count = document.querySelector("#catalog-count");

function createBranch() {
  return { branches: new Map(), examples: [] };
}

function catalogueTree(examples) {
  const root = createBranch();
  for (const example of examples) {
    let branch = root;
    for (const group of example.groups) {
      if (!branch.branches.has(group)) branch.branches.set(group, createBranch());
      branch = branch.branches.get(group);
    }
    branch.examples.push(example);
  }
  return root;
}

function branchCount(branch) {
  return branch.examples.length
    + [...branch.branches.values()].reduce((total, child) => total + branchCount(child), 0);
}

function exampleLink(example) {
  const parameters = new URLSearchParams({
    source: example.path,
    kind: example.kind,
    title: example.title,
  });
  const link = document.createElement("a");
  link.className = "tree-leaf";
  link.href = `./playground/?${parameters}`;
  const title = document.createElement("strong");
  title.textContent = example.title;
  const path = document.createElement("small");
  path.textContent = example.path;
  link.append(title, path);
  return link;
}

function renderBranch(branch, container, depth = 0) {
  const sortedBranches = [...branch.branches.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [name, child] of sortedBranches) {
    const details = document.createElement("details");
    details.open = depth === 0;
    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.textContent = name;
    const size = document.createElement("span");
    size.textContent = `${branchCount(child)} examples`;
    summary.append(label, size);
    details.append(summary);
    renderBranch(child, details, depth + 1);
    container.append(details);
  }
  if (branch.examples.length > 0) {
    const leaves = document.createElement("div");
    leaves.className = "tree-leaves";
    for (const example of branch.examples) leaves.append(exampleLink(example));
    container.append(leaves);
  }
}

function matches(example, query) {
  if (!query) return true;
  return [example.title, example.path, ...example.groups, ...example.features]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function render(examples) {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = examples.filter((example) => matches(example, query));
  tree.replaceChildren();
  renderBranch(catalogueTree(visible), tree);
  count.value = `${visible.length} of ${examples.length} examples`;
}

try {
  const response = await fetch("./playground/generated/catalog.json");
  if (!response.ok) throw new Error(`catalogue request failed (${response.status})`);
  const catalog = await response.json();
  if (!Array.isArray(catalog.examples)) throw new TypeError("catalogue has no examples");
  render(catalog.examples);
  search.addEventListener("input", () => render(catalog.examples));
} catch (error) {
  count.value = "Catalogue unavailable";
  const message = document.createElement("p");
  message.className = "catalog-error";
  message.textContent = error.message;
  tree.replaceChildren(message);
}
