// Global state
let map;
let gtfsData = {
    routes: [],
    trips: [],
    stops: [],
    stop_times: [],
    shapes: [],
    calendar: [],
    calendar_dates: []
};
let routeLayers = {}; // Store Leaflet layers for routes, keyed by route_id
let stopMarkers = {}; // Store Leaflet markers for stops, keyed by stop_id
let selectedRouteIds = new Set();

// DOM Elements
const gtfsUploadInput = document.getElementById('gtfs-upload');
const selectedRoutesListDiv = document.getElementById('selected-routes-list');
const exportButton = document.getElementById('export-button');
const mapDiv = document.getElementById('map');
const loadingIndicator = document.getElementById('loading-indicator');

// --- 1. File Handling and Parsing ---
gtfsUploadInput.addEventListener('change', handleFileUpload);

async function handleFileUpload(event) {
    loadingIndicator.style.display = 'block'; // Show loading indicator
    await new Promise(resolve => setTimeout(resolve, 0)); // Allow DOM to update

    const file = event.target.files[0];
    if (!file) {
        console.error("No file selected.");
        return;
    }

    console.log("File selected:", file.name);
    const jszip = new JSZip();
    try {
        const zip = await jszip.loadAsync(file);
        console.log("ZIP loaded successfully.");

        const parsePromises = [];
        const requiredFiles = ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt'];
        const optionalFiles = ['shapes.txt', 'calendar.txt', 'calendar_dates.txt'];

        requiredFiles.forEach(fileName => {
            const fileEntry = zip.file(fileName);
            if (fileEntry) {
                parsePromises.push(
                    fileEntry.async('string').then(content => {
                        const key = fileName.replace('.txt', '');
                        gtfsData[key] = Papa.parse(content, { header: true, skipEmptyLines: true }).data;
                        console.log(`Parsed ${fileName}`, gtfsData[key].length, "records");
                    }).catch(err => console.error(`Error parsing ${fileName}:`, err))
                );
            } else {
                alert(`Required GTFS file "${fileName}" not found in the archive.`);
                throw new Error(`Required GTFS file "${fileName}" not found.`);
            }
        });

        optionalFiles.forEach(fileName => {
            const fileEntry = zip.file(fileName);
            if (fileEntry) {
                parsePromises.push(
                    fileEntry.async('string').then(content => {
                        const key = fileName.replace('.txt', '');
                        gtfsData[key] = Papa.parse(content, { header: true, skipEmptyLines: true }).data;
                        console.log(`Parsed ${fileName}`, gtfsData[key].length, "records");
                    }).catch(err => console.error(`Error parsing ${fileName}:`, err))
                );
            } else {
                console.log(`Optional GTFS file "${fileName}" not found, proceeding without it.`);
                const key = fileName.replace('.txt', '');
                gtfsData[key] = []; // Ensure it's an empty array if not present
            }
        });

        await Promise.all(parsePromises);
        console.log("All GTFS files parsed:", gtfsData);

        initializeMap();
        displayGtfsData();

    } catch (error) {
        console.error("Error processing GTFS zip file:", error);
        alert("Failed to process GTFS file. Make sure it's a valid GTFS .zip archive. Error: " + error.message);
        // Reset if necessary
        gtfsData = { routes: [], trips: [], stops: [], stop_times: [], shapes: [], calendar: [], calendar_dates: [] };
        if (map) map.remove(); map = null;
        selectedRoutesListDiv.innerHTML = '<p>Error loading data.</p>';
        exportButton.disabled = true;
        loadingIndicator.style.display = 'none'; // Hide indicator on error too
    }
}

// --- 2. Map Initialization and Display ---
function initializeMap() {
    if (map) { // If map already exists, remove it before re-initializing
        map.remove();
    }
    map = L.map(mapDiv).setView([0, 0], 2); // Default view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    console.log("Map initialized.");
}

function displayGtfsData() {
    if (!map) {
        console.error("Map not initialized before displaying data.");
        return;
    }
    // Clear existing layers
    Object.values(routeLayers).forEach(layer => map.removeLayer(layer));
    Object.values(stopMarkers).forEach(marker => map.removeLayer(marker));
    routeLayers = {};
    stopMarkers = {};

    const bounds = L.latLngBounds();

    // Process shapes efficiently
    const processedShapes = {}; // Key: shape_id, Value: sorted array of [lat, lon]
    if (gtfsData.shapes && gtfsData.shapes.length > 0) {
        console.time("ShapeProcessing");
        const tempShapes = {}; // Store points temporarily before sorting
        gtfsData.shapes.forEach(shapePt => {
            if (!shapePt.shape_id) return; // Skip if no shape_id

            const lat = parseFloat(shapePt.shape_pt_lat);
            const lon = parseFloat(shapePt.shape_pt_lon);
            const seq = parseInt(shapePt.shape_pt_sequence, 10);

            if (isNaN(lat) || isNaN(lon) || isNaN(seq)) {
                // console.warn("Invalid shape point data:", shapePt);
                return; // Skip invalid point
            }

            if (!tempShapes[shapePt.shape_id]) {
                tempShapes[shapePt.shape_id] = [];
            }
            tempShapes[shapePt.shape_id].push({ lat, lon, seq });
        });

        for (const shapeId in tempShapes) {
            // Sort points by sequence
            tempShapes[shapeId].sort((a, b) => a.seq - b.seq);
            // Convert to Leaflet [lat, lon] format
            processedShapes[shapeId] = tempShapes[shapeId].map(pt => [pt.lat, pt.lon]);
        }
        console.timeEnd("ShapeProcessing");
        console.log("Shapes processed (optimized):", Object.keys(processedShapes).length);
    }


    // Create a map of route_id to its shape_ids
    const routeToShapeIds = {};
    gtfsData.trips.forEach(trip => {
        if (trip.route_id && trip.shape_id && processedShapes[trip.shape_id]) {
            if (!routeToShapeIds[trip.route_id]) {
                routeToShapeIds[trip.route_id] = new Set();
            }
            routeToShapeIds[trip.route_id].add(trip.shape_id);
        }
    });

    gtfsData.routes.forEach(route => {
        const currentRouteShapeIds = routeToShapeIds[route.route_id];
        if (currentRouteShapeIds && currentRouteShapeIds.size > 0) {
            currentRouteShapeIds.forEach(shapeId => {
                const shapeCoords = processedShapes[shapeId]; // Use the processed shapes
                if (shapeCoords && shapeCoords.length >= 2) {
                    try {
                        const polyline = L.polyline(shapeCoords, {
                            className: 'route-default', // Apply default CSS class
                            weight: 3
                        })
                        .bindPopup(`<b>Route:</b> ${route.route_short_name || route.route_long_name}<br><b>ID:</b> ${route.route_id}`)
                        // Store direct reference to route_id for click events
                        polyline.gtfsRouteId = route.route_id;
                        // Add to map - actual adding to map will be handled by selection logic or initial draw
                        // For now, we add all to map and then style them
                        polyline.addTo(map);


                        if (!routeLayers[route.route_id]) {
                            routeLayers[route.route_id] = [];
                        }
                        routeLayers[route.route_id].push(polyline); // A route can have multiple shape polylines

                        shapeCoords.forEach(coord => bounds.extend(coord));
                    } catch (e) {
                        console.warn(`Could not create polyline for shape_id ${shapeId} of route ${route.route_id}:`, e, shapeCoords);
                    }
                }
            });
        }
    });
    console.log("Routes drawn:", Object.keys(routeLayers).length);


    // Process and draw stops
    gtfsData.stops.forEach(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (!isNaN(lat) && !isNaN(lon)) {
            const marker = L.circleMarker([lat, lon], {
                radius: 5,
                className: 'stop-default', // Apply default CSS class
                fillColor: 'gray', // Default color
                color: '#000',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }).bindPopup(`<b>Stop:</b> ${stop.stop_name}<br><b>ID:</b> ${stop.stop_id}`);
            marker.gtfsStopId = stop.stop_id; // Store stop_id for potential future use
            // marker.addTo(map); // Add later based on selection or if always visible
            stopMarkers[stop.stop_id] = marker;
            bounds.extend([lat, lon]);
        }
    });
    // Initially, all stops are drawn with default style
    Object.values(stopMarkers).forEach(marker => marker.addTo(map));
    console.log("Stops processed:", Object.keys(stopMarkers).length);

    if (bounds.isValid()) {
        map.fitBounds(bounds);
    } else {
        console.warn("No valid bounds to fit map to. GTFS data might be empty or invalid.");
        map.setView([0,0], 2); // Fallback
    }

    // Initial UI update
    updateSelectedRoutesList();
    updateExportButtonStatus();
    updateRouteAndStopStyles(); // Ensure initial styles are applied

    // Add click listeners to routes for selection
    addRouteClickListeners();

    loadingIndicator.style.display = 'none'; // Hide loading indicator
    console.log("Finished displaying GTFS data.");
}

// --- 3. Interactivity and Selection ---

function addRouteClickListeners() {
    for (const routeId in routeLayers) {
        routeLayers[routeId].forEach(polyline => {
            polyline.on('click', function(e) {
                // 'this' refers to the polyline layer here
                // L.DomEvent.stopPropagation(e); // Prevent map click if needed
                toggleRouteSelection(this.gtfsRouteId);
            });
        });
    }
    console.log("Route click listeners added.");
}

function toggleRouteSelection(routeId) {
    if (selectedRouteIds.has(routeId)) {
        selectedRouteIds.delete(routeId);
        console.log(`Route ${routeId} deselected.`);
    } else {
        selectedRouteIds.add(routeId);
        console.log(`Route ${routeId} selected.`);
    }
    updateRouteAndStopStyles();
    updateSelectedRoutesList();
    updateExportButtonStatus();
}

function updateRouteAndStopStyles() {
    // Update route styles
    for (const routeId in routeLayers) {
        const isSelected = selectedRouteIds.has(routeId);
        routeLayers[routeId].forEach(polyline => {
            if (isSelected) {
                polyline.setStyle({ color: '#007bff', opacity: 1.0, weight: 5 }); // .route-selected style
                polyline.bringToFront();
            } else {
                polyline.setStyle({ color: 'gray', opacity: 0.6, weight: 3 }); // .route-default style
            }
        });
    }

    // Update stop styles based on selected routes
    const stopsOnSelectedRoutes = getStopsForSelectedRoutes();
    for (const stopId in stopMarkers) {
        const marker = stopMarkers[stopId];
        if (stopsOnSelectedRoutes.has(stopId)) {
            marker.setStyle({ fillColor: '#ffc107', radius: 7, color: '#000', weight: 1, opacity: 1, fillOpacity: 0.9 }); // .stop-selected style (e.g., yellow)
            marker.bringToFront();
        } else {
            marker.setStyle({ fillColor: 'gray', radius: 5, color: '#000', weight: 1, opacity: 1, fillOpacity: 0.8 }); // .stop-default style
        }
    }
}

function getStopsForSelectedRoutes() {
    const relevantStopIds = new Set();
    if (selectedRouteIds.size === 0) {
        return relevantStopIds; // No routes selected, so no stops are "selected"
    }

    // Find trips associated with selected routes
    const relevantTripIds = new Set();
    gtfsData.trips.forEach(trip => {
        if (selectedRouteIds.has(trip.route_id)) {
            relevantTripIds.add(trip.trip_id);
        }
    });

    // Find stops associated with these trips via stop_times
    gtfsData.stop_times.forEach(st => {
        if (relevantTripIds.has(st.trip_id)) {
            relevantStopIds.add(st.stop_id);
        }
    });
    return relevantStopIds;
}

function updateSelectedRoutesList() {
    if (selectedRouteIds.size === 0) {
        selectedRoutesListDiv.innerHTML = '<p>No routes selected yet. Click on a route on the map to select it.</p>';
        return;
    }

    let html = '<ul>';
    selectedRouteIds.forEach(routeId => {
        const route = gtfsData.routes.find(r => r.route_id === routeId);
        const routeName = route ? (route.route_short_name || route.route_long_name) : `ID: ${routeId}`;
        html += `<li>${routeName}</li>`;
    });
    html += '</ul>';
    selectedRoutesListDiv.innerHTML = html;
}

function updateExportButtonStatus() {
    exportButton.disabled = selectedRouteIds.size === 0;
}

// Initial call to disable button, etc.
// This is already called at the end of displayGtfsData, which is good.

// --- 4. Pruning and Export Logic ---
exportButton.addEventListener('click', exportPrunedGtfs);

async function exportPrunedGtfs() {
    if (selectedRouteIds.size === 0) {
        alert("No routes selected to export.");
        return;
    }
    console.log("Starting GTFS pruning and export for routes:", selectedRouteIds);

    const prunedData = {
        routes: [],
        trips: [],
        stop_times: [],
        stops: [],
        shapes: [],
        calendar: [],
        calendar_dates: []
        // agency.txt, etc. can be passed through directly or also filtered if necessary
    };

    // 1. Filter Routes
    prunedData.routes = gtfsData.routes.filter(route => selectedRouteIds.has(route.route_id));
    console.log("Pruned routes:", prunedData.routes.length);

    // 2. Filter Trips (and collect trip_ids and shape_ids)
    const keptTripIds = new Set();
    const keptShapeIds = new Set();
    prunedData.trips = gtfsData.trips.filter(trip => {
        if (selectedRouteIds.has(trip.route_id)) {
            keptTripIds.add(trip.trip_id);
            if (trip.shape_id && trip.shape_id.trim() !== "") { // Ensure shape_id is not just whitespace
                keptShapeIds.add(trip.shape_id.trim()); // Trim shape_id before adding
            }
            return true;
        }
        return false;
    });
    console.log("Pruned trips:", prunedData.trips.length, "Kept trip IDs:", keptTripIds.size, "Kept shape IDs:", keptShapeIds.size);

    // 3. Filter Stop Times (and collect stop_ids)
    const keptStopIds = new Set();
    prunedData.stop_times = gtfsData.stop_times.filter(st => {
        if (keptTripIds.has(st.trip_id)) {
            keptStopIds.add(st.stop_id);
            return true;
        }
        return false;
    });
    console.log("Pruned stop_times:", prunedData.stop_times.length, "Kept stop IDs:", keptStopIds.size);

    // 4. Filter Stops
    prunedData.stops = gtfsData.stops.filter(stop => keptStopIds.has(stop.stop_id));
    console.log("Pruned stops:", prunedData.stops.length);

    // 5. Filter Shapes (if shapes.txt existed)
    console.log("--- Shape Export Diagnostics ---");
    if (gtfsData.shapes && gtfsData.shapes.length > 0) {
        console.log(`Original gtfsData.shapes point count: ${gtfsData.shapes.length}`);
        console.log(`Number of unique shape_ids to keep (from keptShapeIds): ${keptShapeIds.size}`);

        let pointsWithMissingShapeId = 0;
        let pointsWithKeptShapeId = 0;

        gtfsData.shapes.forEach(shapePt => {
            if (!shapePt.shape_id || shapePt.shape_id.trim() === "") {
                pointsWithMissingShapeId++;
            } else if (keptShapeIds.has(shapePt.shape_id)) {
                pointsWithKeptShapeId++;
            }
        });

        console.log(`Source shape points missing a shape_id (or empty string): ${pointsWithMissingShapeId}`);
        console.log(`Source shape points that have a shape_id IN keptShapeIds: ${pointsWithKeptShapeId}`);

        prunedData.shapes = gtfsData.shapes.filter(shapePt => {
            // Ensure shapePt.shape_id is valid and in keptShapeIds
            return shapePt.shape_id && shapePt.shape_id.trim() !== "" && keptShapeIds.has(shapePt.shape_id);
        });
        console.log("Final prunedData.shapes point count:", prunedData.shapes.length);

        if (pointsWithKeptShapeId !== prunedData.shapes.length) {
            console.warn("Potential discrepancy: Number of source points matching keptShapeIds does not equal final pruned shapes count. This might indicate issues with shape_id values (e.g. nulls, undefined, leading/trailing spaces if not trimmed in Set addition or check).");
        }

    } else {
        prunedData.shapes = []; // Ensure it's an empty array if original was empty
        console.log("No shapes data in original GTFS or gtfsData.shapes is empty.");
    }
    console.log("--- End Shape Export Diagnostics ---");


    // (Optional but good practice) Filter calendar.txt and calendar_dates.txt
    // This requires knowing service_ids used by the kept trips.
    const keptServiceIds = new Set();
    prunedData.trips.forEach(trip => {
        if (trip.service_id) {
            keptServiceIds.add(trip.service_id);
        }
    });
    console.log("Kept service_ids:", keptServiceIds.size);

    if (gtfsData.calendar && gtfsData.calendar.length > 0) {
        prunedData.calendar = gtfsData.calendar.filter(cal => keptServiceIds.has(cal.service_id));
        console.log("Pruned calendar entries:", prunedData.calendar.length);
    } else {
        prunedData.calendar = [];
    }

    if (gtfsData.calendar_dates && gtfsData.calendar_dates.length > 0) {
        prunedData.calendar_dates = gtfsData.calendar_dates.filter(cd => keptServiceIds.has(cd.service_id));
        console.log("Pruned calendar_dates entries:", prunedData.calendar_dates.length);
    } else {
        prunedData.calendar_dates = [];
    }

    // Pass through other files directly (agency.txt, feed_info.txt etc.)
    // For this example, we'll only explicitly handle the core and optional files mentioned.
    // A more robust solution might iterate through all original files.
    const otherFilesToKeep = ['agency.txt', 'feed_info.txt', 'transfers.txt', 'pathways.txt', 'levels.txt', 'fare_attributes.txt', 'fare_rules.txt'];
    otherFilesToKeep.forEach(fileName => {
        const key = fileName.replace('.txt', '');
        if (gtfsData[key] && gtfsData[key].length > 0) {
            prunedData[key] = gtfsData[key]; // For simplicity, pass through entirely. Could be filtered too.
            console.log(`Passing through ${fileName} with ${prunedData[key].length} records`);
        } else {
            prunedData[key] = [];
        }
    });


    // Create new ZIP file
    const newZip = new JSZip();
    let fileCount = 0;

    for (const key in prunedData) {
        if (prunedData[key] && prunedData[key].length > 0) {
            // Papa.unparse needs an array of objects, or an array of arrays for the header.
            // If gtfsData[key] was parsed with header:true, then prunedData[key] is an array of objects.
            // We need to ensure we get the headers correctly.
            // The easiest way to get original headers is to unparse with original data's first row if available,
            // or rely on PapaParse's ability to derive headers from object keys.
            const csvString = Papa.unparse(prunedData[key], { header: true });
            newZip.file(`${key}.txt`, csvString);
            fileCount++;
            console.log(`Added ${key}.txt to zip with ${prunedData[key].length} records.`);
        } else if (Object.prototype.hasOwnProperty.call(gtfsData, key) && gtfsData[key] && gtfsData[key].length === 0 && key !== 'shapes' && key !== 'calendar' && key !== 'calendar_dates') {
            // Add empty files if they were empty in the original (except for conditional ones like shapes)
            // For files like shapes, calendar, calendar_dates, only add if they had data originally AND have data after pruning.
            // Or, if they are optional and were not present, don't create empty ones.
            // This logic might need refinement based on strict GTFS spec for empty files.
            // For now, only add if there's data.
        }
    }

    if (fileCount === 0) {
        alert("The pruned selection resulted in no data to export. Please check your selections.");
        return;
    }

    try {
        const content = await newZip.generateAsync({ type: "blob" });
        // Trigger download
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = "gtfs_pruned.zip";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href); // Clean up
        console.log("Pruned GTFS zip file generated and download triggered.");
    } catch (err) {
        console.error("Error generating zip file:", err);
        alert("Error generating zip file: " + err.message);
    }
}

console.log("script.js loaded. Waiting for file upload.");
// alert("script.js loaded. Please upload a GTFS .zip file to begin."); // Remove or comment out for less noise
