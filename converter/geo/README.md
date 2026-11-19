# Map coordinates

`maps/` holds one calibration file per map picture: the pixel positions of a few towns on the map, which `../geo.py` fits to give present-day latitude and longitude for any point on the map. `python geo.py compile` turns them into `NIV html/data/geo.js`, which the app's picture viewer reads.

Sources:

- `gazetteer.json` is derived from the [Bible Geocoding Data](https://github.com/openbibleinfo/Bible-Geocoding-Data) of OpenBible.info, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each ancient place keeps the coordinates of its best-scoring modern identification.
- `wikidata.json` caches coordinates from [Wikidata](https://www.wikidata.org/) (CC0) for places the gazetteer lacks, such as Troy, Mari and Ugarit.
