# Contributing to JAF Documentation

This guide explains how to contribute to the JAF documentation and work with MkDocs.

## Prerequisites

- Python 3.x installed
- pip (Python package manager)
- Git

## Setting Up Your Environment

1. **Clone the repository**:
   ```bash
   git clone https://github.com/xynehq/jaf.git
   cd jaf
   ```

2. **Install documentation dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

## Running the Documentation Locally

### Quick Start

Use the provided script:
```bash
./docs/serve.sh
```

### Manual Start

Or run MkDocs directly:
```bash
mkdocs serve
```

Visit `http://127.0.0.1:8000` to see the documentation site. It will automatically reload when you make changes.

## Documentation Structure

```
docs/
├── README.md              # Home page
├── getting-started.md     # Getting started guide
├── core-concepts.md       # Core concepts
├── adk-layer.md          # ADK Layer documentation
├── a2a-protocol.md       # A2A Protocol documentation
├── api-reference.md      # API reference
├── visualization.md      # Visualization guide
└── ...                   # Other documentation files
```

## Writing Documentation

### Markdown Guidelines

1. **Use clear headings**: Start with `#` for main title, `##` for sections
2. **Code blocks**: Use triple backticks with language identifier
3. **Links**: Use relative links for internal documentation
4. **Admonitions**: Use MkDocs Material admonitions for notes and warnings

### Admonition Examples

```markdown
!!! note
    This is a note admonition.

!!! warning
    This is a warning admonition.

!!! tip
    This is a tip admonition.

!!! example
    This is an example admonition.
```

### Code Block Examples

````markdown
```typescript
// TypeScript code with syntax highlighting
const agent = createAgent({
  name: 'my-agent',
  model: 'gpt-4',
  tools: []
});
```
````

### Adding New Pages

1. Create a new `.md` file in the `docs/` directory
2. Add the page to the navigation in `mkdocs.yml`:
   ```yaml
   nav:
     - Your Section:
       - Your New Page: your-new-page.md
   ```

## Building for Production

To build the static site:
```bash
mkdocs build
```

This creates a `site/` directory with the static HTML files.

## Deploying Documentation

Documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch. The GitHub Actions workflow handles:

1. Building the documentation
2. Running validation checks
3. Deploying to GitHub Pages

## Best Practices

1. **Keep it Simple**: Write for clarity and understanding
2. **Use Examples**: Include practical code examples
3. **Stay Consistent**: Follow existing documentation patterns
4. **Test Locally**: Always preview changes before committing
5. **Update Navigation**: Add new pages to `mkdocs.yml`
6. **Check Links**: Ensure all internal links work

## MkDocs Features

### Search

The documentation includes full-text search. Users can press `/` to focus the search bar.

### Dark Mode

Users can toggle between light and dark themes using the sun/moon icon.

### Code Copy

Code blocks include a copy button for easy copying.

### Table of Contents

Each page has an automatic table of contents on the right side.

## Troubleshooting

### Common Issues

1. **MkDocs not found**: Install dependencies with `pip install -r requirements.txt`
2. **Port already in use**: Kill the process using port 8000 or use `mkdocs serve -a localhost:8001`
3. **Build errors**: Check for invalid YAML in `mkdocs.yml` or broken markdown syntax

### Getting Help

- Check the [MkDocs documentation](https://www.mkdocs.org/)
- Review [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/)
- Open an issue in the JAF repository