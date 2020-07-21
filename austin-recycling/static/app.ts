/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

interface Store extends GeoJSON.Feature {
  properties: {
    business_name: string;
    address_address: string;
    zip_code: string;
    distanceText?: string;
    distanceValue?: number;
  };
}

let distanceMatrixService: google.maps.DistanceMatrixService;
let map: google.maps.Map;
let originMarker: google.maps.Marker;
let infowindow: google.maps.InfoWindow;

let circles: google.maps.Circle[] = [];
let stores: Store[] = [];

// The location of Austin, TX
const AUSTIN = { lat: 30.262129, lng: -97.7468 };

async function initialize() {
  initMap();

  // Add an "info" window that pops up when user clicks on an individual
  // location. Content of info window is entirely up to us.
  infowindow = new google.maps.InfoWindow();

  // Initialize the Places Autocomplete Widget
  initAutocompleteWidget();

  // Fetch and render stores as circles on map
  fetchAndRenderStores(AUSTIN);
}

const initMap = () => {
  distanceMatrixService = new google.maps.DistanceMatrixService();

  // The map, centered on Austin, TX
  map = new google.maps.Map(document.querySelector("#map"), {
    center: AUSTIN,
    zoom: 12,
    mapId: "YOUR_MAP_ID",
    clickableIcons: false,
    fullscreenControl: false,
    mapTypeControl: false,
    rotateControl: true,
    scaleControl: false,
    streetViewControl: true,
    zoomControl: true,
  } as google.maps.MapOptions);
};

const fetchAndRenderStores = async (center: google.maps.LatLngLiteral) => {
  stores = (await fetchStores(center)).features;
  circles = stores.map((store) => storeToCircle(store, map, infowindow));
};


const fetchStores = async (
    center: google.maps.LatLngLiteral
): Promise<{ type: "FeatureCollection"; features: Store[] }> => {
  const url = `/data/dropoffs?centerLat=${center.lat}&centerLng=${center.lng}`;
  const response = await fetch(url);
  return response.json();
};

const storeToCircle = (
  store: Store,
  map: google.maps.Map,
  infowindow: google.maps.InfoWindow
): google.maps.Circle => {
  const [lng, lat] = (store.geometry as GeoJSON.Point).coordinates;

  const circle = new google.maps.Circle({
    radius: 50,
    strokeColor: "#579d42",
    strokeOpacity: 0.8,
    strokeWeight: 5,
    center: { lat, lng },
    map,
  });

  circle.addListener("click", () => {
    infowindow.setContent(
      `${store.properties.business_name}<br />
      ${store.properties.address_address}<br />
      Austin, TX ${store.properties.zip_code}`
    );
    infowindow.setPosition({ lat, lng });
    infowindow.setOptions({ pixelOffset: new google.maps.Size(0, -30) });
    infowindow.open(map);
  });

  return circle;
};

const initAutocompleteWidget = () => {
  // Add search bar for auto-complete
  // Build and add the search bar
  const placesAutoCompleteCardElement = document.getElementById("pac-card");
  const placesAutoCompleteInputElement = placesAutoCompleteCardElement.querySelector(
    "input"
  );

  const options = {
    types: ["address"],
    componentRestrictions: { country: "us" },
    map,
  };

  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(
    placesAutoCompleteCardElement
  );

  // Make the search bar into a Places Autocomplete search bar and select
  // which detail fields should be returned about the place that
  // the user selects from the suggestions.
  const autocomplete = new google.maps.places.Autocomplete(
    placesAutoCompleteInputElement,
    options
  );

  autocomplete.setFields(["address_components", "geometry", "name"]);

  map.addListener("bounds_changed", () => {
    autocomplete.setBounds(map.getBounds());
  });

  // Respond when a user selects an address
  // Set the origin point when the user selects an address
  originMarker = new google.maps.Marker({ map: map });
  originMarker.setVisible(false);
  let originLocation = map.getCenter();

  autocomplete.addListener("place_changed", async () => {
    circles.forEach((c) => c.setMap(null)); // clear existing stores

    originMarker.setVisible(false);
    originLocation = map.getCenter();
    const place = autocomplete.getPlace();

    if (!place.geometry) {
      // User entered the name of a Place that was not suggested and
      // pressed the Enter key, or the Place Details request failed.
      window.alert("No address available for input: '" + place.name + "'");
      return;
    }

    // Recenter the map to the selected address
    originLocation = place.geometry.location;
    map.setCenter(originLocation);
    map.setZoom(map.getZoom());

    originMarker.setPosition(originLocation);
    originMarker.setVisible(true);

    await fetchAndRenderStores(originLocation.toJSON());

    // Use the selected address as the origin to calculate distances
    // to each of the store locations
    await calculateDistances(originLocation, stores);
    renderStoresPanel();
  });
};

async function calculateDistances(origin: google.maps.LatLng, stores: Store[]) {
  // Retrieve the distances of each store from the origin
  // The returned list will be in the same order as the destinations list
  const response = await getDistanceMatrix({
    origins: [origin],
    destinations: stores.map((store) => {
      const [lng, lat] = (store.geometry as GeoJSON.Point).coordinates;
      return { lat, lng };
    }),
    travelMode: google.maps.TravelMode.DRIVING,
    unitSystem: google.maps.UnitSystem.METRIC,
  });

  response.rows[0].elements.forEach((element, index) => {
    stores[index].properties.distanceText = element.distance.text;
    stores[index].properties.distanceValue = element.distance.value;
  });
}

const getDistanceMatrix = (
  request: google.maps.DistanceMatrixRequest
): Promise<google.maps.DistanceMatrixResponse> => {
  return new Promise((resolve, reject) => {
    const callback = (
      response: google.maps.DistanceMatrixResponse,
      status: google.maps.DistanceMatrixStatus
    ) => {
      if (status === google.maps.DistanceMatrixStatus.OK) {
        resolve(response);
      } else {
        reject(response);
      }
    };
    distanceMatrixService.getDistanceMatrix(request, callback);
  });
};

function renderStoresPanel() {
  const panel = document.getElementById("panel") as HTMLDivElement;

  if (stores.length == 0) {
    panel.classList.remove("open");

    return;
  }

  // Clear the previous panel rows
  while (panel.lastChild) {
    panel.removeChild(panel.lastChild);
  }

  stores
    .sort((a, b) => a.properties.distanceValue - b.properties.distanceValue)
    .forEach((store) => {
      panel.appendChild(storeToPanelRow(store));
    });

  // Open the panel
  panel.classList.add("open");

  return;
}

const storeToPanelRow = (store: Store) => {
  // Add store details with text formatting
  const rowElement = document.createElement("div");

  const nameElement = document.createElement("p");
  nameElement.classList.add("place");
  nameElement.textContent = store.properties.business_name;
  rowElement.appendChild(nameElement);

  const distanceTextElement = document.createElement("p");
  distanceTextElement.classList.add("distanceText");
  distanceTextElement.textContent = store.properties.distanceText;
  rowElement.appendChild(distanceTextElement);

  return rowElement;
};