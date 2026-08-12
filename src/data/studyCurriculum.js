// ── ARIA Study Curriculum ─────────────────────────────────────────
// Auto-built with stable lesson IDs. Do not edit IDs by hand; re-run
// scripts/buildStudyCurriculum.js to regenerate.

const LANGUAGES = {
  "html": {
    "name": "HTML",
    "tagline": "The skeleton of every web page",
    "levels": {
      "beginner": [
        {
          "title": "What is HTML?",
          "topic": "The language that structures every web page — tags, elements, and how browsers read them.",
          "learn": "You'll learn what HTML is, how a page is built, and your first tags.",
          "id": "html-beginner-what-is-html-1"
        },
        {
          "title": "Document structure",
          "topic": "The <!DOCTYPE>, <html>, <head>, and <body> skeleton every page needs.",
          "learn": "You'll write a complete, valid HTML page skeleton by hand.",
          "id": "html-beginner-document-structure-2"
        },
        {
          "title": "Headings, text, and paragraphs",
          "topic": "h1-h6, p, strong, em, and how to format readable content.",
          "learn": "You'll structure a page with headings and formatted text.",
          "id": "html-beginner-headings-text-and-paragraphs-3"
        },
        {
          "title": "Links and anchors",
          "topic": "The <a> tag, href, target, and navigating between pages and sections.",
          "learn": "You'll build internal + external links and jump-to-section anchors.",
          "id": "html-beginner-links-and-anchors-4"
        },
        {
          "title": "Images and media",
          "topic": "The <img> tag, src, alt, and how to embed video/audio.",
          "learn": "You'll add accessible images and media with proper attributes.",
          "id": "html-beginner-images-and-media-5"
        },
        {
          "title": "Lists",
          "topic": "Ordered, unordered, and nested lists with <ul>, <ol>, <li>.",
          "learn": "You'll build clean lists including a navigation menu.",
          "id": "html-beginner-lists-6"
        },
        {
          "title": "Tables",
          "topic": "Building tabular data with <table>, <tr>, <th>, <td>, colspan.",
          "learn": "You'll construct a styled data table with merged cells.",
          "id": "html-beginner-tables-7"
        },
        {
          "title": "Forms",
          "topic": "Inputs, labels, buttons, and the <form> element.",
          "learn": "You'll build a working contact form with multiple input types.",
          "id": "html-beginner-forms-8",
          "quiz": {
            "question": "Which element is used to group a label with an input for accessibility?",
            "options": [
              "<span>",
              "<div>",
              "<label>",
              "<input>"
            ],
            "answer": "C",
            "explain": "The <label> element associates text with an input, improving accessibility.",
            "retryExplain": "It's the element that labels the input field — <label>."
          }
        },
        {
          "title": "Semantic HTML",
          "topic": "header, nav, main, section, article, footer for accessible structure.",
          "learn": "You'll convert a div-soup page into semantic HTML.",
          "id": "html-beginner-semantic-html-9"
        },
        {
          "title": "Your first project",
          "topic": "Combining everything into a personal bio page.",
          "learn": "You'll build a complete, multi-section HTML page from scratch.",
          "id": "html-beginner-your-first-project-10"
        }
      ],
      "intermediate": [
        {
          "title": "Input types in depth",
          "topic": "email, number, date, range, file, and validation attributes.",
          "learn": "You'll build forms with proper input types + built-in validation.",
          "id": "html-intermediate-input-types-in-depth-1"
        },
        {
          "title": "Form attributes and validation",
          "topic": "required, pattern, minlength, autocomplete, and submitting data.",
          "learn": "You'll add robust client-side validation to a form.",
          "id": "html-intermediate-form-attributes-and-validation-2"
        },
        {
          "title": "Iframes and embedded content",
          "topic": "embedding YouTube, maps, and external content safely.",
          "learn": "You'll embed external media and learn sandboxing.",
          "id": "html-intermediate-iframes-and-embedded-content-3"
        },
        {
          "title": "Accessibility (a11y) basics",
          "topic": "aria-*, roles, alt text, and keyboard navigation.",
          "learn": "You'll make a page accessible to screen readers and keyboard users.",
          "id": "html-intermediate-accessibility-a11y-basics-4"
        },
        {
          "title": "SEO meta tags",
          "topic": "title, description, Open Graph, and structured data.",
          "learn": "You'll optimize a page's meta for search + social sharing.",
          "id": "html-intermediate-seo-meta-tags-5"
        },
        {
          "title": "Data attributes and the DOM",
          "topic": "data-* attributes and how JS reads them.",
          "learn": "You'll wire data attributes that JavaScript can interact with.",
          "id": "html-intermediate-data-attributes-and-the-dom-6"
        },
        {
          "title": "Multimedia and responsive embeds",
          "topic": "making images, video, and iframes responsive.",
          "learn": "You'll build media that scales cleanly across screen sizes.",
          "id": "html-intermediate-multimedia-and-responsive-embeds-7"
        }
      ],
      "advanced": [
        {
          "title": "HTML APIs",
          "topic": "Geolocation, Drag and Drop, and the File API.",
          "learn": "You'll use browser APIs directly in HTML/JS.",
          "id": "html-advanced-html-apis-1"
        },
        {
          "title": "Canvas basics",
          "topic": "drawing 2D graphics with the <canvas> element.",
          "learn": "You'll render shapes, paths, and animations on canvas.",
          "id": "html-advanced-canvas-basics-2"
        },
        {
          "title": "SVG in HTML",
          "topic": "inline scalable vector graphics and their properties.",
          "learn": "You'll build crisp, scalable SVG graphics inline.",
          "id": "html-advanced-svg-in-html-3"
        },
        {
          "title": "Microdata and structured data",
          "topic": "schema.org, itemprop, and rich snippets.",
          "learn": "You'll mark up content that search engines parse as rich results.",
          "id": "html-advanced-microdata-and-structured-data-4"
        },
        {
          "title": "Web components intro",
          "topic": "custom elements, shadow DOM, and templates.",
          "learn": "You'll create a reusable custom HTML element.",
          "id": "html-advanced-web-components-intro-5"
        },
        {
          "title": "Performance and semantics at scale",
          "topic": "critical HTML, avoiding layout thrash, asset loading.",
          "learn": "You'll structure HTML that loads fast and renders efficiently.",
          "id": "html-advanced-performance-and-semantics-at-scale-6"
        }
      ],
      "pro": [
        {
          "title": "Building design systems in HTML",
          "topic": "consistent, maintainable markup across large apps.",
          "learn": "You'll architect reusable HTML patterns for a full product.",
          "id": "html-pro-building-design-systems-in-html-1"
        },
        {
          "title": "Accessibility compliance (WCAG)",
          "topic": "meeting WCAG 2.x AA criteria with real semantics.",
          "learn": "You'll audit + fix a page to WCAG AA standard.",
          "id": "html-pro-accessibility-compliance-wcag-2"
        },
        {
          "title": "Progressive enhancement & SSR",
          "topic": "server-rendered HTML that works without JS.",
          "learn": "You'll build an app that degrades gracefully and hydrates.",
          "id": "html-pro-progressive-enhancement-ssr-3"
        },
        {
          "title": "HTML in modern frameworks",
          "topic": "how React/Vue/Svelte compile to the DOM and virtual DOM.",
          "learn": "You'll understand the rendering pipeline behind frameworks.",
          "id": "html-pro-html-in-modern-frameworks-4"
        },
        {
          "title": "Capstone: a complete landing page",
          "topic": "all concepts — semantics, a11y, SEO, media, forms.",
          "learn": "You'll ship a production-quality landing page.",
          "id": "html-pro-capstone-a-complete-landing-page-5"
        }
      ]
    }
  },
  "css": {
    "name": "CSS",
    "tagline": "Make it beautiful",
    "levels": {
      "beginner": [
        {
          "title": "What is CSS?",
          "topic": "Cascading Style Sheets — how styling is applied to HTML.",
          "learn": "You'll link a stylesheet and style your first element.",
          "id": "css-beginner-what-is-css-1"
        },
        {
          "title": "Selectors and properties",
          "topic": "element, class, id, and the box model.",
          "learn": "You'll target elements precisely and understand the box model.",
          "id": "css-beginner-selectors-and-properties-2"
        },
        {
          "title": "Colors, fonts, and text",
          "topic": "color, background, font-family, and typography.",
          "learn": "You'll style text with color, spacing, and fonts.",
          "id": "css-beginner-colors-fonts-and-text-3"
        },
        {
          "title": "The box model",
          "topic": "margin, padding, border, and content sizing.",
          "learn": "You'll control spacing and layout with the box model.",
          "id": "css-beginner-the-box-model-4"
        },
        {
          "title": "Display and positioning",
          "topic": "block, inline, relative, absolute, fixed.",
          "learn": "You'll position elements with confidence.",
          "id": "css-beginner-display-and-positioning-5"
        },
        {
          "title": "Flexbox",
          "topic": "aligning and distributing space in one dimension.",
          "learn": "You'll build responsive nav and card layouts with flexbox.",
          "id": "css-beginner-flexbox-6",
          "quiz": {
            "question": "Which property controls horizontal distribution in a flex container?",
            "options": [
              "align-items",
              "justify-content",
              "flex-direction",
              "position"
            ],
            "answer": "B",
            "explain": "justify-content controls alignment along the main axis (horizontal by default).",
            "retryExplain": "It's the one that spreads items across the row — justify-content."
          }
        },
        {
          "title": "Grid basics",
          "topic": "two-dimensional layout with CSS Grid.",
          "learn": "You'll build a responsive page grid with grid-template.",
          "id": "css-beginner-grid-basics-7"
        },
        {
          "title": "Responsive design",
          "topic": "media queries, mobile-first, and breakpoints.",
          "learn": "You'll make a layout adapt to any screen.",
          "id": "css-beginner-responsive-design-8"
        },
        {
          "title": "Transitions and hover",
          "topic": "smooth state changes on hover/focus.",
          "learn": "You'll add polished hover and transition effects.",
          "id": "css-beginner-transitions-and-hover-9"
        },
        {
          "title": "Your first project",
          "topic": "style a complete landing page.",
          "learn": "You'll apply everything to a styled, responsive page.",
          "id": "css-beginner-your-first-project-10"
        }
      ],
      "intermediate": [
        {
          "title": "Pseudo-classes and pseudo-elements",
          "topic": ":hover, :nth-child, ::before, ::after.",
          "learn": "You'll create rich states and decorative elements.",
          "id": "css-intermediate-pseudo-classes-and-pseudo-elements-1"
        },
        {
          "title": "CSS variables",
          "topic": "custom properties and theme-driven styling.",
          "learn": "You'll build a themable design with CSS variables.",
          "id": "css-intermediate-css-variables-2"
        },
        {
          "title": "Advanced selectors",
          "topic": "attribute, sibling, and descendant combinators.",
          "learn": "You'll write powerful, minimal CSS with clever selectors.",
          "id": "css-intermediate-advanced-selectors-3"
        },
        {
          "title": "Animations and keyframes",
          "topic": "@keyframes, animation shorthand, easing.",
          "learn": "You'll build smooth, performant animations.",
          "id": "css-intermediate-animations-and-keyframes-4"
        },
        {
          "title": "Transform and 3D",
          "topic": "translate, rotate, scale, perspective.",
          "learn": "You'll create depth and motion with transforms.",
          "id": "css-intermediate-transform-and-3d-5"
        },
        {
          "title": "Responsive images and fluid type",
          "topic": "clamp(), srcset, object-fit.",
          "learn": "You'll build fully fluid, performant layouts.",
          "id": "css-intermediate-responsive-images-and-fluid-type-6"
        },
        {
          "title": "Positioning mastery",
          "topic": "sticky, z-index, stacking contexts.",
          "learn": "You'll control stacking and sticky elements precisely.",
          "id": "css-intermediate-positioning-mastery-7"
        },
        {
          "title": "Design tokens and BEM",
          "topic": "naming conventions and scalable CSS architecture.",
          "learn": "You'll organize CSS for large projects.",
          "id": "css-intermediate-design-tokens-and-bem-8"
        }
      ],
      "advanced": [
        {
          "title": "CSS architecture (BEM/SMACSS)",
          "topic": "scalable, maintainable class naming.",
          "learn": "You'll architect a maintainable CSS codebase.",
          "id": "css-advanced-css-architecture-bem-smacss-1"
        },
        {
          "title": "Sass/SCSS preprocessors",
          "topic": "variables, nesting, mixins, partials.",
          "learn": "You'll build with SCSS and compile it.",
          "id": "css-advanced-sass-scss-preprocessors-2"
        },
        {
          "title": "Modern layout techniques",
          "topic": "subgrid, container queries, logical properties.",
          "learn": "You'll use bleeding-edge layout features.",
          "id": "css-advanced-modern-layout-techniques-3"
        },
        {
          "title": "CSS-in-JS and styled systems",
          "topic": "styled-components, Tailwind, utility classes.",
          "learn": "You'll compare and apply CSS-in-JS approaches.",
          "id": "css-advanced-css-in-js-and-styled-systems-4"
        },
        {
          "title": "Performance and paint",
          "topic": "compositing, will-change, avoiding repaints.",
          "learn": "You'll keep animations and layout at 60fps.",
          "id": "css-advanced-performance-and-paint-5"
        },
        {
          "title": "Dark mode & theming",
          "topic": "prefers-color-scheme and theme switching.",
          "learn": "You'll implement robust dark mode.",
          "id": "css-advanced-dark-mode-theming-6"
        },
        {
          "title": "Print and accessibility styles",
          "topic": "@media print and accessible focus states.",
          "learn": "You'll style print output and a11y states.",
          "id": "css-advanced-print-and-accessibility-styles-7"
        }
      ],
      "pro": [
        {
          "title": "Design systems at scale",
          "topic": "tokens, components, and consistent theming.",
          "learn": "You'll ship a full design system in CSS.",
          "id": "css-pro-design-systems-at-scale-1"
        },
        {
          "title": "Critical CSS and load optimization",
          "topic": "inlining critical styles, purging unused CSS.",
          "learn": "You'll optimize CSS delivery for fast first paint.",
          "id": "css-pro-critical-css-and-load-optimization-2"
        },
        {
          "title": "Advanced responsive architecture",
          "topic": "container queries, fluid spacing, complex grids.",
          "learn": "You'll build adaptive UIs that handle any content.",
          "id": "css-pro-advanced-responsive-architecture-3"
        },
        {
          "title": "Web animations at scale",
          "topic": "WAAPI, scroll-driven, and framework animations.",
          "learn": "You'll build production animation systems.",
          "id": "css-pro-web-animations-at-scale-4"
        },
        {
          "title": "Capstone: a polished component library",
          "topic": "all CSS skills combined.",
          "learn": "You'll ship a reusable, themed component library.",
          "id": "css-pro-capstone-a-polished-component-library-5"
        }
      ]
    }
  },
  "js": {
    "name": "JavaScript",
    "tagline": "Make it interactive",
    "levels": {
      "beginner": [
        {
          "title": "What is JavaScript?",
          "topic": "The language that runs in every browser.",
          "learn": "You'll run your first script and understand how JS executes.",
          "id": "js-beginner-what-is-javascript-1"
        },
        {
          "title": "Variables and data types",
          "topic": "let, const, strings, numbers, booleans, null, undefined.",
          "learn": "You'll store and use data with the right types.",
          "id": "js-beginner-variables-and-data-types-2"
        },
        {
          "title": "Operators and expressions",
          "topic": "arithmetic, comparison, and logical operators.",
          "learn": "You'll write expressions that compute and compare.",
          "id": "js-beginner-operators-and-expressions-3"
        },
        {
          "title": "Functions",
          "topic": "declaring, calling, parameters, and return values.",
          "learn": "You'll write reusable functions.",
          "id": "js-beginner-functions-4",
          "exercise": {
            "lang": "js",
            "prompt": "Write a function named add that returns a + b, then call add(2,3) and print the result.",
            "expected": "5"
          }
        },
        {
          "title": "Control flow",
          "topic": "if/else, switch, and ternary.",
          "learn": "You'll make your code branch on conditions.",
          "id": "js-beginner-control-flow-5"
        },
        {
          "title": "Loops",
          "topic": "for, while, and iterating over data.",
          "learn": "You'll repeat logic cleanly with loops.",
          "id": "js-beginner-loops-6",
          "quiz": {
            "question": "Which loop runs its body at least once even if the condition is false?",
            "options": [
              "for loop",
              "while loop",
              "do...while loop",
              "for...of loop"
            ],
            "answer": "C",
            "explain": "do...while checks the condition AFTER running the body, so it always runs at least once.",
            "retryExplain": "Remember: do...while runs the body first, then checks the condition."
          },
          "exercise": {
            "lang": "js",
            "prompt": "Write a for loop that prints the numbers 1 to 5, one per line.",
            "expected": "1\n2\n3\n4\n5"
          }
        },
        {
          "title": "Arrays",
          "topic": "creating, accessing, and array methods.",
          "learn": "You'll work with collections of data.",
          "id": "js-beginner-arrays-7"
        },
        {
          "title": "Objects",
          "topic": "properties, methods, and accessing object data.",
          "learn": "You'll model real things as objects.",
          "id": "js-beginner-objects-8"
        },
        {
          "title": "The DOM",
          "topic": "selecting and modifying page elements.",
          "learn": "You'll make the page react to your code.",
          "id": "js-beginner-the-dom-9"
        },
        {
          "title": "Events",
          "topic": "click, input, and event listeners.",
          "learn": "You'll build interactive buttons and forms.",
          "id": "js-beginner-events-10"
        },
        {
          "title": "Your first project",
          "topic": "a mini interactive app (counter/to-do).",
          "learn": "You'll combine everything into a working app.",
          "id": "js-beginner-your-first-project-11"
        }
      ],
      "intermediate": [
        {
          "title": "Arrays & objects in depth",
          "topic": "map, filter, reduce, destructuring, spread.",
          "learn": "You'll transform data elegantly.",
          "id": "js-intermediate-arrays-objects-in-depth-1"
        },
        {
          "title": "Closures and scope",
          "topic": "how functions capture variables and lexical scoping.",
          "learn": "You'll understand and use closures.",
          "id": "js-intermediate-closures-and-scope-2"
        },
        {
          "title": "Higher-order functions",
          "topic": "functions that take/return functions.",
          "learn": "You'll write flexible, composable code.",
          "id": "js-intermediate-higher-order-functions-3"
        },
        {
          "title": "Asynchronous JS",
          "topic": "callbacks, promises, async/await.",
          "learn": "You'll handle async operations cleanly.",
          "id": "js-intermediate-asynchronous-js-4",
          "quiz": {
            "question": "Which keyword pauses a function until a Promise resolves?",
            "options": [
              "await",
              "yield",
              "return",
              "catch"
            ],
            "answer": "A",
            "explain": "await pauses execution until the awaited Promise settles, inside an async function.",
            "retryExplain": "Think of pausing execution until the promise finishes — that's await."
          }
        },
        {
          "title": "Fetch and APIs",
          "topic": "calling REST APIs and handling JSON.",
          "learn": "You'll build a data-driven feature.",
          "id": "js-intermediate-fetch-and-apis-5"
        },
        {
          "title": "Classes and OOP",
          "topic": "constructors, methods, inheritance.",
          "learn": "You'll model systems with classes.",
          "id": "js-intermediate-classes-and-oop-6"
        },
        {
          "title": "Error handling",
          "topic": "try/catch, throwing, and debugging.",
          "learn": "You'll write resilient code that fails gracefully.",
          "id": "js-intermediate-error-handling-7"
        },
        {
          "title": "ES6+ features",
          "topic": "template literals, arrow functions, modules.",
          "learn": "You'll write modern, clean JavaScript.",
          "id": "js-intermediate-es6-features-8"
        }
      ],
      "advanced": [
        {
          "title": "The event loop",
          "topic": "call stack, task/microtask queues, timing.",
          "learn": "You'll understand how async actually executes.",
          "id": "js-advanced-the-event-loop-1"
        },
        {
          "title": "Prototypes and this",
          "topic": "prototype chain, binding, call/apply.",
          "learn": "You'll master JavaScript's object model.",
          "id": "js-advanced-prototypes-and-this-2"
        },
        {
          "title": "Functional programming",
          "topic": "immutability, currying, pure functions.",
          "learn": "You'll write predictable, testable functions.",
          "id": "js-advanced-functional-programming-3"
        },
        {
          "title": "ES modules and bundling",
          "topic": "import/export, tree shaking, bundlers.",
          "learn": "You'll architect modular apps.",
          "id": "js-advanced-es-modules-and-bundling-4"
        },
        {
          "title": "Regular expressions",
          "topic": "patterns, capture groups, and text processing.",
          "learn": "You'll parse and validate text with regex.",
          "id": "js-advanced-regular-expressions-5"
        },
        {
          "title": "Working with data structures",
          "topic": "Map, Set, stacks, queues.",
          "learn": "You'll choose the right structure for the job.",
          "id": "js-advanced-working-with-data-structures-6"
        },
        {
          "title": "Browser storage & state",
          "topic": "localStorage, sessionStorage, state management.",
          "learn": "You'll persist and manage app state.",
          "id": "js-advanced-browser-storage-state-7"
        },
        {
          "title": "Performance & memory",
          "topic": "garbage collection, avoiding leaks, profiling.",
          "learn": "You'll write memory-safe, fast code.",
          "id": "js-advanced-performance-memory-8"
        }
      ],
      "pro": [
        {
          "title": "The language spec & engines",
          "topic": "how V8/JIT engines compile and optimize.",
          "learn": "You'll write code that engines optimize well.",
          "id": "js-pro-the-language-spec-engines-1"
        },
        {
          "title": "Design patterns in JS",
          "topic": "module, observer, factory, singleton, etc.",
          "learn": "You'll apply battle-tested patterns.",
          "id": "js-pro-design-patterns-in-js-2"
        },
        {
          "title": "Concurrency and workers",
          "topic": "Web Workers, service workers, parallelism.",
          "learn": "You'll move heavy work off the main thread.",
          "id": "js-pro-concurrency-and-workers-3"
        },
        {
          "title": "Advanced async & streams",
          "topic": "generators, iterators, async iterators, streams.",
          "learn": "You'll handle infinite data and backpressure.",
          "id": "js-pro-advanced-async-streams-4"
        },
        {
          "title": "Building a JS framework-level library",
          "topic": "reactive rendering, virtual DOM concepts.",
          "learn": "You'll build a mini reactive UI library.",
          "id": "js-pro-building-a-js-framework-level-library-5"
        },
        {
          "title": "Capstone: a production SPA",
          "topic": "everything combined.",
          "learn": "You'll ship a complete, optimized web app.",
          "id": "js-pro-capstone-a-production-spa-6"
        }
      ]
    }
  },
  "react": {
    "name": "React",
    "tagline": "Build component UIs",
    "levels": {
      "beginner": [
        {
          "title": "What is React?",
          "topic": "A library for building UIs from components.",
          "learn": "You'll set up a React app and render your first component.",
          "id": "react-beginner-what-is-react-1"
        },
        {
          "title": "JSX",
          "topic": "writing markup inside JavaScript.",
          "learn": "You'll build components using JSX syntax.",
          "id": "react-beginner-jsx-2"
        },
        {
          "title": "Components and props",
          "topic": "function components and passing data with props.",
          "learn": "You'll compose UIs from reusable components.",
          "id": "react-beginner-components-and-props-3"
        },
        {
          "title": "State with useState",
          "topic": "the first state hook.",
          "learn": "You'll make components remember and update data.",
          "id": "react-beginner-state-with-usestate-4"
        },
        {
          "title": "Rendering lists",
          "topic": "mapping arrays to elements with keys.",
          "learn": "You'll render dynamic lists correctly.",
          "id": "react-beginner-rendering-lists-5"
        },
        {
          "title": "Handling events",
          "topic": "onClick, onChange, and handlers.",
          "learn": "You'll make components interactive.",
          "id": "react-beginner-handling-events-6"
        },
        {
          "title": "Conditional rendering",
          "topic": "showing UI based on state.",
          "learn": "You'll build dynamic, context-aware UI.",
          "id": "react-beginner-conditional-rendering-7"
        },
        {
          "title": "Forms in React",
          "topic": "controlled inputs and state.",
          "learn": "You'll build and manage form state.",
          "id": "react-beginner-forms-in-react-8"
        },
        {
          "title": "Your first project",
          "topic": "a small interactive React app.",
          "learn": "You'll build a working React app from scratch.",
          "id": "react-beginner-your-first-project-9"
        }
      ],
      "intermediate": [
        {
          "title": "useEffect",
          "topic": "side effects, lifecycle, and cleanup.",
          "learn": "You'll fetch data and sync with outside systems.",
          "id": "react-intermediate-useeffect-1"
        },
        {
          "title": "Lifting state up",
          "topic": "sharing state across components.",
          "learn": "You'll architect state flow between components.",
          "id": "react-intermediate-lifting-state-up-2"
        },
        {
          "title": "useRef and the DOM",
          "topic": "referencing DOM nodes and mutable values.",
          "learn": "You'll interact with DOM directly when needed.",
          "id": "react-intermediate-useref-and-the-dom-3"
        },
        {
          "title": "Styling components",
          "topic": "CSS modules, inline, styled-components.",
          "learn": "You'll style React components cleanly.",
          "id": "react-intermediate-styling-components-4"
        },
        {
          "title": "React Router",
          "topic": "client-side navigation between pages.",
          "learn": "You'll build a multi-page React app.",
          "id": "react-intermediate-react-router-5"
        },
        {
          "title": "Context API",
          "topic": "sharing data without prop drilling.",
          "learn": "You'll manage global state with context.",
          "id": "react-intermediate-context-api-6"
        },
        {
          "title": "Custom hooks",
          "topic": "extracting reusable logic.",
          "learn": "You'll write your own hooks.",
          "id": "react-intermediate-custom-hooks-7"
        },
        {
          "title": "Fetching data",
          "topic": "APIs, loading/error states.",
          "learn": "You'll build robust data-fetching components.",
          "id": "react-intermediate-fetching-data-8"
        }
      ],
      "advanced": [
        {
          "title": "useReducer and state machines",
          "topic": "complex state transitions.",
          "learn": "You'll model complex UI state predictably.",
          "id": "react-advanced-usereducer-and-state-machines-1"
        },
        {
          "title": "React performance",
          "topic": "memo, useMemo, useCallback.",
          "learn": "You'll optimize re-renders.",
          "id": "react-advanced-react-performance-2"
        },
        {
          "title": "Compound components",
          "topic": "flexible component APIs.",
          "learn": "You'll build extensible component systems.",
          "id": "react-advanced-compound-components-3"
        },
        {
          "title": "Render props and patterns",
          "topic": "advanced composition patterns.",
          "learn": "You'll compose components in powerful ways.",
          "id": "react-advanced-render-props-and-patterns-4"
        },
        {
          "title": "Error boundaries",
          "topic": "catching errors in the UI.",
          "learn": "You'll build crash-resistant apps.",
          "id": "react-advanced-error-boundaries-5"
        },
        {
          "title": "Portals and refs",
          "topic": "rendering outside the tree, imperative handles.",
          "learn": "You'll build modals and advanced interactions.",
          "id": "react-advanced-portals-and-refs-6"
        },
        {
          "title": "Testing components",
          "topic": "Jest, Testing Library, rendering/assertions.",
          "learn": "You'll write reliable component tests.",
          "id": "react-advanced-testing-components-7"
        },
        {
          "title": "React 18+ features",
          "topic": "concurrent rendering, transitions, Suspense.",
          "learn": "You'll use modern React capabilities.",
          "id": "react-advanced-react-18-features-8"
        }
      ],
      "pro": [
        {
          "title": "Architecture for scale",
          "topic": "folder structure, feature modules, design systems.",
          "learn": "You'll architect a large React codebase.",
          "id": "react-pro-architecture-for-scale-1"
        },
        {
          "title": "State management at scale",
          "topic": "Redux/Zustand, selectors, middleware, devtools.",
          "learn": "You'll build predictable global state.",
          "id": "react-pro-state-management-at-scale-2"
        },
        {
          "title": "Server components & SSR",
          "topic": "Next.js, server rendering, streaming, hydration.",
          "learn": "You'll build fast, SEO-friendly apps.",
          "id": "react-pro-server-components-ssr-3"
        },
        {
          "title": "Performance engineering",
          "topic": "code splitting, lazy loading, bundle analysis.",
          "learn": "You'll optimize load and render performance.",
          "id": "react-pro-performance-engineering-4"
        },
        {
          "title": "Advanced patterns",
          "topic": "HOCs, render props vs hooks, controlled components.",
          "learn": "You'll master React composition.",
          "id": "react-pro-advanced-patterns-5"
        },
        {
          "title": "React + TypeScript",
          "topic": "typing props, state, and components.",
          "learn": "You'll write type-safe React.",
          "id": "react-pro-react-typescript-6"
        },
        {
          "title": "Capstone: a production app",
          "topic": "all skills combined.",
          "learn": "You'll ship a complete, optimized React app.",
          "id": "react-pro-capstone-a-production-app-7"
        }
      ]
    }
  },
  "node": {
    "name": "Node.js",
    "tagline": "JavaScript on the server",
    "levels": {
      "beginner": [
        {
          "title": "What is Node.js?",
          "topic": "Running JavaScript outside the browser.",
          "learn": "You'll run your first Node script.",
          "id": "node-beginner-what-is-node-js-1"
        },
        {
          "title": "Modules and require",
          "topic": "the CommonJS module system.",
          "learn": "You'll split code into modules.",
          "id": "node-beginner-modules-and-require-2"
        },
        {
          "title": "The file system",
          "topic": "reading and writing files with fs.",
          "learn": "You'll work with files from Node.",
          "id": "node-beginner-the-file-system-3"
        },
        {
          "title": "Core modules",
          "topic": "path, os, url, and more built-ins.",
          "learn": "You'll use Node's standard library.",
          "id": "node-beginner-core-modules-4"
        },
        {
          "title": "HTTP servers",
          "topic": "building a basic server with the http module.",
          "learn": "You'll serve HTTP responses from Node.",
          "id": "node-beginner-http-servers-5"
        },
        {
          "title": "NPM and packages",
          "topic": "installing, requiring, and managing dependencies.",
          "learn": "You'll use third-party packages.",
          "id": "node-beginner-npm-and-packages-6"
        },
        {
          "title": "Express basics",
          "topic": "routes, middleware, and responses.",
          "learn": "You'll build a small web API.",
          "id": "node-beginner-express-basics-7"
        },
        {
          "title": "JSON and APIs",
          "topic": "serving and consuming JSON.",
          "learn": "You'll build a JSON API.",
          "id": "node-beginner-json-and-apis-8"
        },
        {
          "title": "Your first project",
          "topic": "a small CLI or HTTP tool.",
          "learn": "You'll ship a working Node tool.",
          "id": "node-beginner-your-first-project-9"
        }
      ],
      "intermediate": [
        {
          "title": "Async patterns",
          "topic": "callbacks, promises, async/await in Node.",
          "learn": "You'll write clean async server code.",
          "id": "node-intermediate-async-patterns-1"
        },
        {
          "title": "Express routing in depth",
          "topic": "params, query strings, route handlers.",
          "learn": "You'll build a full REST API.",
          "id": "node-intermediate-express-routing-in-depth-2"
        },
        {
          "title": "Middleware",
          "topic": "custom middleware, error handling, logging.",
          "learn": "You'll structure Express apps properly.",
          "id": "node-intermediate-middleware-3"
        },
        {
          "title": "Working with databases",
          "topic": "connecting SQL/NoSQL (sqlite/mongo).",
          "learn": "You'll persist data in an app.",
          "id": "node-intermediate-working-with-databases-4"
        },
        {
          "title": "Environment variables",
          "topic": "config, .env, secrets.",
          "learn": "You'll configure apps safely.",
          "id": "node-intermediate-environment-variables-5"
        },
        {
          "title": "Authentication basics",
          "topic": "sessions, JWTs, hashing passwords.",
          "learn": "You'll secure routes with auth.",
          "id": "node-intermediate-authentication-basics-6"
        },
        {
          "title": "RESTful design",
          "topic": "resources, verbs, status codes.",
          "learn": "You'll design clean APIs.",
          "id": "node-intermediate-restful-design-7"
        },
        {
          "title": "File uploads",
          "topic": "handling multipart uploads.",
          "learn": "You'll accept and store uploads.",
          "id": "node-intermediate-file-uploads-8"
        }
      ],
      "advanced": [
        {
          "title": "Event-driven architecture",
          "topic": "EventEmitter and streams.",
          "learn": "You'll build event-driven systems.",
          "id": "node-advanced-event-driven-architecture-1"
        },
        {
          "title": "Streams and buffers",
          "topic": "handling large data efficiently.",
          "learn": "You'll process streams with backpressure.",
          "id": "node-advanced-streams-and-buffers-2"
        },
        {
          "title": "Clustering and child processes",
          "topic": "scaling with clusters and workers.",
          "learn": "You'll run parallel work in Node.",
          "id": "node-advanced-clustering-and-child-processes-3"
        },
        {
          "title": "Testing Node apps",
          "topic": "unit/integration tests, mocking.",
          "learn": "You'll test servers and logic.",
          "id": "node-advanced-testing-node-apps-4"
        },
        {
          "title": "WebSockets",
          "topic": "real-time bidirectional communication.",
          "learn": "You'll build live, real-time features.",
          "id": "node-advanced-websockets-5"
        },
        {
          "title": "Security best practices",
          "topic": "input validation, rate limiting, headers.",
          "learn": "You'll harden an Express app.",
          "id": "node-advanced-security-best-practices-6"
        },
        {
          "title": "Caching and performance",
          "topic": "in-memory caches, ETags, profiling.",
          "learn": "You'll speed up server responses.",
          "id": "node-advanced-caching-and-performance-7"
        }
      ],
      "pro": [
        {
          "title": "Microservices & architecture",
          "topic": "splitting apps into services, messaging.",
          "learn": "You'll design a distributed system.",
          "id": "node-pro-microservices-architecture-1"
        },
        {
          "title": "Advanced DB & query optimization",
          "topic": "indexing, transactions, connection pooling.",
          "learn": "You'll optimize data access.",
          "id": "node-pro-advanced-db-query-optimization-2"
        },
        {
          "title": "Deployment & DevOps",
          "topic": "containers, CI/CD, process managers.",
          "learn": "You'll ship and run Node in production.",
          "id": "node-pro-deployment-devops-3"
        },
        {
          "title": "Observability",
          "topic": "logging, metrics, tracing.",
          "learn": "You'll monitor a production service.",
          "id": "node-pro-observability-4"
        },
        {
          "title": "GraphQL",
          "topic": "typed queries vs REST.",
          "learn": "You'll build a GraphQL API.",
          "id": "node-pro-graphql-5"
        },
        {
          "title": "Building a framework",
          "topic": "creating an Express-like router.",
          "learn": "You'll understand frameworks from the inside.",
          "id": "node-pro-building-a-framework-6"
        },
        {
          "title": "Capstone: a production API",
          "topic": "everything combined.",
          "learn": "You'll ship a complete, secure, scalable API.",
          "id": "node-pro-capstone-a-production-api-7"
        }
      ]
    }
  },
  "python": {
    "name": "Python",
    "tagline": "Readable, powerful, everywhere",
    "levels": {
      "beginner": [
        {
          "title": "What is Python?",
          "topic": "A clean, versatile programming language.",
          "learn": "You'll run your first Python program.",
          "id": "python-beginner-what-is-python-1"
        },
        {
          "title": "Variables and types",
          "topic": "strings, ints, floats, booleans.",
          "learn": "You'll store and manipulate data.",
          "id": "python-beginner-variables-and-types-2"
        },
        {
          "title": "Input and output",
          "topic": "print(), input(), and formatting.",
          "learn": "You'll build interactive console programs.",
          "id": "python-beginner-input-and-output-3"
        },
        {
          "title": "Conditionals",
          "topic": "if/elif/else.",
          "learn": "You'll make decisions in code.",
          "id": "python-beginner-conditionals-4"
        },
        {
          "title": "Loops",
          "topic": "for and while loops.",
          "learn": "You'll repeat logic and iterate.",
          "id": "python-beginner-loops-5",
          "exercise": {
            "lang": "py",
            "prompt": "Write a for loop that prints the numbers 1 to 5, one per line.",
            "expected": "1\n2\n3\n4\n5"
          }
        },
        {
          "title": "Lists and tuples",
          "topic": "ordered collections.",
          "learn": "You'll work with collections of data.",
          "id": "python-beginner-lists-and-tuples-6",
          "quiz": {
            "question": "What does len([1, 2, 3]) return?",
            "options": [
              "2",
              "3",
              "4",
              "An error"
            ],
            "answer": "B",
            "explain": "len() returns the number of items in the list — three items here.",
            "retryExplain": "len() counts how many items are in the collection."
          }
        },
        {
          "title": "Dictionaries",
          "topic": "key-value pairs.",
          "learn": "You'll model structured data.",
          "id": "python-beginner-dictionaries-7"
        },
        {
          "title": "Functions",
          "topic": "defining, parameters, returns.",
          "learn": "You'll write reusable functions.",
          "id": "python-beginner-functions-8"
        },
        {
          "title": "String methods",
          "topic": "slicing, formatting, splitting.",
          "learn": "You'll manipulate text powerfully.",
          "id": "python-beginner-string-methods-9"
        },
        {
          "title": "Your first project",
          "topic": "a small utility/guessing game.",
          "learn": "You'll build a working Python program.",
          "id": "python-beginner-your-first-project-10"
        }
      ],
      "intermediate": [
        {
          "title": "Files",
          "topic": "reading and writing text files.",
          "learn": "You'll persist data to files.",
          "id": "python-intermediate-files-1"
        },
        {
          "title": "Error handling",
          "topic": "try/except/else/finally.",
          "learn": "You'll handle failures gracefully.",
          "id": "python-intermediate-error-handling-2"
        },
        {
          "title": "List comprehensions",
          "topic": "concise list building.",
          "learn": "You'll write expressive one-liners.",
          "id": "python-intermediate-list-comprehensions-3"
        },
        {
          "title": "Dictionaries and sets in depth",
          "topic": "comprehensions, set operations.",
          "learn": "You'll master data structures.",
          "id": "python-intermediate-dictionaries-and-sets-in-depth-4"
        },
        {
          "title": "Modules and packages",
          "topic": "imports, __name__, organizing code.",
          "learn": "You'll structure multi-file programs.",
          "id": "python-intermediate-modules-and-packages-5"
        },
        {
          "title": "Classes and OOP",
          "topic": "objects, methods, inheritance.",
          "learn": "You'll model systems with classes.",
          "id": "python-intermediate-classes-and-oop-6"
        },
        {
          "title": "Working with JSON",
          "topic": "parsing and generating JSON.",
          "learn": "You'll handle structured data.",
          "id": "python-intermediate-working-with-json-7"
        },
        {
          "title": "Libraries: requests & OS",
          "topic": "HTTP calls and system interactions.",
          "learn": "You'll fetch data and interact with the OS.",
          "id": "python-intermediate-libraries-requests-os-8"
        }
      ],
      "advanced": [
        {
          "title": "Iterators and generators",
          "topic": "yield and lazy evaluation.",
          "learn": "You'll build memory-efficient iterators.",
          "id": "python-advanced-iterators-and-generators-1"
        },
        {
          "title": "Decorators",
          "topic": "wrapping functions elegantly.",
          "learn": "You'll extend behavior with decorators.",
          "id": "python-advanced-decorators-2"
        },
        {
          "title": "Context managers",
          "topic": "with statements and resource cleanup.",
          "learn": "You'll manage resources safely.",
          "id": "python-advanced-context-managers-3"
        },
        {
          "title": "Functional tools",
          "topic": "map, filter, reduce, lambda.",
          "learn": "You'll write functional-style code.",
          "id": "python-advanced-functional-tools-4"
        },
        {
          "title": "Data analysis with pandas",
          "topic": "DataFrames and manipulation.",
          "learn": "You'll analyze tabular data.",
          "id": "python-advanced-data-analysis-with-pandas-5"
        },
        {
          "title": "Web scraping",
          "topic": "requests + BeautifulSoup.",
          "learn": "You'll extract data from web pages.",
          "id": "python-advanced-web-scraping-6"
        },
        {
          "title": "Testing with pytest",
          "topic": "unit tests, fixtures, assertions.",
          "learn": "You'll write reliable tests.",
          "id": "python-advanced-testing-with-pytest-7"
        },
        {
          "title": "Virtual environments & pip",
          "topic": "managing dependencies.",
          "learn": "You'll isolate and share projects.",
          "id": "python-advanced-virtual-environments-pip-8"
        }
      ],
      "pro": [
        {
          "title": "Concurrency",
          "topic": "threads, multiprocessing, asyncio.",
          "learn": "You'll run parallel Python.",
          "id": "python-pro-concurrency-1"
        },
        {
          "title": "Metaclasses and advanced OOP",
          "topic": "customizing class creation.",
          "learn": "You'll wield advanced language features.",
          "id": "python-pro-metaclasses-and-advanced-oop-2"
        },
        {
          "title": "Performance optimization",
          "topic": "profiling, C extensions, Numba.",
          "learn": "You'll speed up Python code.",
          "id": "python-pro-performance-optimization-3"
        },
        {
          "title": "Building a web API (FastAPI)",
          "topic": "typed, async endpoints.",
          "learn": "You'll build a modern Python API.",
          "id": "python-pro-building-a-web-api-fastapi-4"
        },
        {
          "title": "Automation & scripting",
          "topic": "CLI tools, scheduling, scripting.",
          "learn": "You'll automate real workflows.",
          "id": "python-pro-automation-scripting-5"
        },
        {
          "title": "Design patterns",
          "topic": "singleton, factory, observer, etc.",
          "learn": "You'll apply proven patterns.",
          "id": "python-pro-design-patterns-6"
        },
        {
          "title": "Capstone: a data/web project",
          "topic": "everything combined.",
          "learn": "You'll ship a complete Python project.",
          "id": "python-pro-capstone-a-data-web-project-7"
        }
      ]
    }
  },
  "cpp": {
    "name": "C++",
    "tagline": "Fast, low-level, powerful",
    "levels": {
      "beginner": [
        {
          "title": "What is C++?",
          "topic": "A compiled, high-performance language.",
          "learn": "You'll compile and run your first program.",
          "id": "cpp-beginner-what-is-c-1"
        },
        {
          "title": "Variables and data types",
          "topic": "int, double, char, bool.",
          "learn": "You'll work with typed data.",
          "id": "cpp-beginner-variables-and-data-types-2"
        },
        {
          "title": "Input and output",
          "topic": "cin, cout, and formatting.",
          "learn": "You'll build interactive console programs.",
          "id": "cpp-beginner-input-and-output-3"
        },
        {
          "title": "Conditionals",
          "topic": "if/else and switch.",
          "learn": "You'll branch logic.",
          "id": "cpp-beginner-conditionals-4"
        },
        {
          "title": "Loops",
          "topic": "for, while, do-while.",
          "learn": "You'll iterate and repeat.",
          "id": "cpp-beginner-loops-5"
        },
        {
          "title": "Functions",
          "topic": "declaring, parameters, returns.",
          "learn": "You'll write reusable functions.",
          "id": "cpp-beginner-functions-6"
        },
        {
          "title": "Arrays",
          "topic": "fixed-size collections.",
          "learn": "You'll store sequences of data.",
          "id": "cpp-beginner-arrays-7"
        },
        {
          "title": "Strings",
          "topic": "working with std::string.",
          "learn": "You'll manipulate text.",
          "id": "cpp-beginner-strings-8"
        },
        {
          "title": "References and pointers basics",
          "topic": "memory addresses.",
          "learn": "You'll understand how data is stored.",
          "id": "cpp-beginner-references-and-pointers-basics-9"
        },
        {
          "title": "Your first project",
          "topic": "a small console program.",
          "learn": "You'll build a working C++ tool.",
          "id": "cpp-beginner-your-first-project-10"
        }
      ],
      "intermediate": [
        {
          "title": "Pointers and dynamic memory",
          "topic": "new/delete, heap vs stack.",
          "learn": "You'll manage memory manually.",
          "id": "cpp-intermediate-pointers-and-dynamic-memory-1"
        },
        {
          "title": "Structs and classes",
          "topic": "OOP in C++.",
          "learn": "You'll model objects with classes.",
          "id": "cpp-intermediate-structs-and-classes-2"
        },
        {
          "title": "Constructors and destructors",
          "topic": "object lifecycle, RAII.",
          "learn": "You'll manage resource lifecycle.",
          "id": "cpp-intermediate-constructors-and-destructors-3"
        },
        {
          "title": "Operator overloading",
          "topic": "defining operators for types.",
          "learn": "You'll write intuitive types.",
          "id": "cpp-intermediate-operator-overloading-4"
        },
        {
          "title": "STL containers",
          "topic": "vector, map, set, list.",
          "learn": "You'll use the standard library.",
          "id": "cpp-intermediate-stl-containers-5"
        },
        {
          "title": "Functions and lambdas",
          "topic": "std::function, lambda expressions.",
          "learn": "You'll write functional-style C++.",
          "id": "cpp-intermediate-functions-and-lambdas-6"
        },
        {
          "title": "Templates basics",
          "topic": "generic programming.",
          "learn": "You'll write type-generic code.",
          "id": "cpp-intermediate-templates-basics-7"
        },
        {
          "title": "Error handling",
          "topic": "exceptions, try/catch.",
          "learn": "You'll handle failures.",
          "id": "cpp-intermediate-error-handling-8"
        }
      ],
      "advanced": [
        {
          "title": "RAII and smart pointers",
          "topic": "unique_ptr, shared_ptr.",
          "learn": "You'll write exception-safe code.",
          "id": "cpp-advanced-raii-and-smart-pointers-1"
        },
        {
          "title": "Advanced templates",
          "topic": "template metaprogramming, SFINAE.",
          "learn": "You'll write compile-time code.",
          "id": "cpp-advanced-advanced-templates-2"
        },
        {
          "title": "Move semantics",
          "topic": "rvalues, move constructors, perfect forwarding.",
          "learn": "You'll write efficient modern C++.",
          "id": "cpp-advanced-move-semantics-3"
        },
        {
          "title": "STL algorithms",
          "topic": "sort, transform, and the algorithm library.",
          "learn": "You'll write idiomatic algorithms.",
          "id": "cpp-advanced-stl-algorithms-4"
        },
        {
          "title": "Data structures",
          "topic": "implementing lists, stacks, trees.",
          "learn": "You'll build and understand structures.",
          "id": "cpp-advanced-data-structures-5"
        },
        {
          "title": "File I/O and streams",
          "topic": "fstream and stream handling.",
          "learn": "You'll read/write files.",
          "id": "cpp-advanced-file-i-o-and-streams-6"
        },
        {
          "title": "Multithreading",
          "topic": "std::thread, mutex, async.",
          "learn": "You'll write concurrent programs.",
          "id": "cpp-advanced-multithreading-7"
        },
        {
          "title": "The standard library in depth",
          "topic": "chrono, random, string_view, etc.",
          "learn": "You'll leverage modern STL.",
          "id": "cpp-advanced-the-standard-library-in-depth-8"
        }
      ],
      "pro": [
        {
          "title": "C++17/20 features",
          "topic": "structured bindings, concepts, coroutines.",
          "learn": "You'll use modern standards.",
          "id": "cpp-pro-c-17-20-features-1"
        },
        {
          "title": "Memory management mastery",
          "topic": "custom allocators, cache locality.",
          "learn": "You'll write high-performance memory code.",
          "id": "cpp-pro-memory-management-mastery-2"
        },
        {
          "title": "Design patterns in C++",
          "topic": "idioms and patterns for C++.",
          "learn": "You'll apply battle-tested patterns.",
          "id": "cpp-pro-design-patterns-in-c-3"
        },
        {
          "title": "Performance optimization",
          "topic": "profiling, compiler flags, hot paths.",
          "learn": "You'll optimize for speed.",
          "id": "cpp-pro-performance-optimization-4"
        },
        {
          "title": "Game/embedded-style systems",
          "topic": "real-time loops, ECS concepts.",
          "learn": "You'll build real-time systems.",
          "id": "cpp-pro-game-embedded-style-systems-5"
        },
        {
          "title": "CMake and build systems",
          "topic": "multi-file, cross-platform builds.",
          "learn": "You'll manage large C++ projects.",
          "id": "cpp-pro-cmake-and-build-systems-6"
        },
        {
          "title": "Capstone: a complete C++ program",
          "topic": "everything combined.",
          "learn": "You'll ship a robust C++ application.",
          "id": "cpp-pro-capstone-a-complete-c-program-7"
        }
      ]
    }
  },
  "git": {
    "name": "Git & GitHub",
    "tagline": "Version control every dev needs",
    "levels": {
      "beginner": [
        {
          "title": "What is Git?",
          "topic": "tracking changes in your code.",
          "learn": "You'll initialize a repo and understand versioning.",
          "id": "git-beginner-what-is-git-1"
        },
        {
          "title": "Staging and committing",
          "topic": "git add, git commit.",
          "learn": "You'll save snapshots of your work.",
          "id": "git-beginner-staging-and-committing-2"
        },
        {
          "title": "Status and log",
          "topic": "git status, git log.",
          "learn": "You'll inspect repo state and history.",
          "id": "git-beginner-status-and-log-3"
        },
        {
          "title": "Undoing changes",
          "topic": "restore, reset, revert.",
          "learn": "You'll safely undo mistakes.",
          "id": "git-beginner-undoing-changes-4"
        },
        {
          "title": "Branches",
          "topic": "creating and switching branches.",
          "learn": "You'll work on features in isolation.",
          "id": "git-beginner-branches-5"
        },
        {
          "title": "Merging",
          "topic": "git merge and resolving basics.",
          "learn": "You'll combine work from branches.",
          "id": "git-beginner-merging-6"
        },
        {
          "title": "GitHub basics",
          "topic": "remotes, clone, push, pull.",
          "learn": "You'll sync code with GitHub.",
          "id": "git-beginner-github-basics-7"
        },
        {
          "title": "Your first repo workflow",
          "topic": "clone → branch → commit → push → PR.",
          "learn": "You'll complete a real contribution cycle.",
          "id": "git-beginner-your-first-repo-workflow-8"
        }
      ],
      "intermediate": [
        {
          "title": "Resolving merge conflicts",
          "topic": "understanding and fixing conflicts.",
          "learn": "You'll handle conflicting changes.",
          "id": "git-intermediate-resolving-merge-conflicts-1"
        },
        {
          "title": "Rebasing",
          "topic": "git rebase and rewriting history.",
          "learn": "You'll keep a clean linear history.",
          "id": "git-intermediate-rebasing-2"
        },
        {
          "title": "Stashing",
          "topic": "git stash to park work.",
          "learn": "You'll switch context safely.",
          "id": "git-intermediate-stashing-3"
        },
        {
          "title": "Collaboration via PRs",
          "topic": "pull requests, reviews, code review etiquette.",
          "learn": "You'll contribute to teams.",
          "id": "git-intermediate-collaboration-via-prs-4"
        },
        {
          "title": ".gitignore and file handling",
          "topic": "ignoring files, tracking config.",
          "learn": "You'll keep repos clean.",
          "id": "git-intermediate-gitignore-and-file-handling-5"
        },
        {
          "title": "Tags and releases",
          "topic": "versioning with git tags.",
          "learn": "You'll mark releases.",
          "id": "git-intermediate-tags-and-releases-6"
        },
        {
          "title": "Remote branches",
          "topic": "tracking, fetching, pushing branches.",
          "learn": "You'll manage multi-remote workflows.",
          "id": "git-intermediate-remote-branches-7"
        }
      ],
      "advanced": [
        {
          "title": "Git internals",
          "topic": "objects, blobs, trees, commits.",
          "learn": "You'll understand how Git stores data.",
          "id": "git-advanced-git-internals-1"
        },
        {
          "title": "Cherry-picking and reflog",
          "topic": "selective commits and recovery.",
          "learn": "You'll recover and rearrange history safely.",
          "id": "git-advanced-cherry-picking-and-reflog-2"
        },
        {
          "title": "Bisecting bugs",
          "topic": "git bisect to find regressions.",
          "learn": "You'll pinpoint breaking changes.",
          "id": "git-advanced-bisecting-bugs-3"
        },
        {
          "title": "Submodules and subtrees",
          "topic": "managing nested repos.",
          "learn": "You'll handle multi-repo projects.",
          "id": "git-advanced-submodules-and-subtrees-4"
        },
        {
          "title": "Hooks and automation",
          "topic": "pre-commit, CI triggers.",
          "learn": "You'll automate repo workflows.",
          "id": "git-advanced-hooks-and-automation-5"
        },
        {
          "title": "Advanced workflows",
          "topic": "Gitflow, trunk-based, fork workflows.",
          "learn": "You'll pick the right workflow.",
          "id": "git-advanced-advanced-workflows-6"
        }
      ],
      "pro": [
        {
          "title": "Git at enterprise scale",
          "topic": "large teams, monorepos, big history.",
          "learn": "You'll manage huge repos efficiently.",
          "id": "git-pro-git-at-enterprise-scale-1"
        },
        {
          "title": "Security & signed commits",
          "topic": "GPG signing, verified commits.",
          "learn": "You'll secure your Git identity.",
          "id": "git-pro-security-signed-commits-2"
        },
        {
          "title": "CI/CD integration",
          "topic": "GitHub Actions, deploy pipelines.",
          "learn": "You'll automate test + deploy.",
          "id": "git-pro-ci-cd-integration-3"
        },
        {
          "title": "Writing excellent PRs & reviews",
          "topic": "communicating changes effectively.",
          "learn": "You'll lead code reviews.",
          "id": "git-pro-writing-excellent-prs-reviews-4"
        },
        {
          "title": "Capstone: a full collaboration workflow",
          "topic": "everything combined.",
          "learn": "You'll run a complete team workflow.",
          "id": "git-pro-capstone-a-full-collaboration-workflow-5"
        }
      ]
    }
  }
};

module.exports = { LANGUAGES };
