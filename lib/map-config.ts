// Keep the tile URL and its attribution together when changing providers.
export const mapTiles = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};
export const mapTileOrigin = new URL(mapTiles.url).origin;
export const placeSearchUrl = "https://photon.komoot.io/api/";
