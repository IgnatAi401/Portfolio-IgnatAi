# Ignat — Photography

This is the source of **Ignat's personal photography portfolio**: a static site that arranges photographs from travels on an engraved-style world map, a contact-sheet grid and a viewfinder-style full-screen viewer.

**Live site:** <https://photos.ignat.ai>
**Contact:** <https://me.ignat.ai>

## Repository contents

```
designs/
├── index.html            # the site
├── assets/               # styles, scripts, icons, translations
│   └── vendor/           # third-party map libraries and data (with their licenses)
└── shared/photos.json    # photo metadata (titles, places, dates, camera settings)
```

The image files themselves are **not** included in this repository. They are hosted separately and served only on the live site.

## Copyright

**All photographs are © Ignat. All rights reserved.**

The photographs shown on the site, and the descriptive data about them in `designs/shared/photos.json`, are not covered by any open-source license. You may not copy, download for reuse, redistribute, modify, or use any photograph for **commercial purposes**, including advertising, products, publications, or AI/ML training datasets, without prior written permission from the author.

For licensing or other permission requests, please get in touch via <https://me.ignat.ai>.

## Third-party components

The map is drawn with [d3-geo](https://github.com/d3/d3-geo), [d3-array](https://github.com/d3/d3-array), [topojson-client](https://github.com/topojson/topojson-client) and [world-atlas](https://github.com/topojson/world-atlas) (map data from [Natural Earth](https://www.naturalearthdata.com/)). These files are unmodified and remain under their own licenses, included in `designs/assets/vendor/`.
