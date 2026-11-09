
"use strict";

/*
==================================================
SA EVENT MAPS
SILNIK KALIBRACJI WSPÓŁRZĘDNYCH GTA SAN ANDREAS
==================================================

P1-P3: punkty używane do obliczenia transformacji.
P4: niezależny punkt kontrolny.

Obraz:
assets/gtasa-map-shadows

Wynik:
Przekształcenie pikseli obrazu na współrzędne
świata GTA San Andreas oraz odwrotnie.
*/

(() => {

    // ==========================================
    // 1. USTAWIENIA
    // ==========================================

    const MAP_IMAGE_CANDIDATES = [
        "assets/gtasa-map-shadows",
        "assets/gtasa-map-shadows.png",
        "assets/gtasa-map-shadows.PNG",
        "assets/gtasa-map-shadows.jpg",
        "assets/gtasa-map-shadows.JPG",
        "assets/gtasa-map-shadows.jpeg",
        "assets/gtasa-map-shadows.JPEG",
        "assets/gtasa-map-shadows.webp",
        "assets/gtasa-map-shadows.WEBP"
    ];

    const mapElement = document.getElementById(
        "calibration-map"
    );

    if (!mapElement) {
        console.error(
            "Kalibracja: nie znaleziono kontenera mapy."
        );
        return;
    }

    if (typeof L === "undefined") {

        mapElement.textContent =
            "Nie udało się załadować biblioteki Leaflet.";

        return;
    }


    // ==========================================
    // 2. ELEMENTY INTERFEJSU
    // ==========================================

    const elements = {

        dimensions: document.getElementById(
            "map-dimensions"
        ),

        status: document.getElementById(
            "calibration-status"
        ),

        pointList: document.getElementById(
            "control-points"
        ),

        calculate: document.getElementById(
            "calculate-calibration"
        ),

        download: document.getElementById(
            "download-calibration"
        ),

        reset: document.getElementById(
            "reset-calibration"
        ),

        result: document.getElementById(
            "calibration-result"
        )

    };


    // ==========================================
    // 3. PUNKTY KONTROLNE
    // ==========================================

    const points = [

        {
            id: "P1",
            name: "San Fierro",
            role: "Punkt dopasowania",

            world: {
                x: -2705.664,
                y: 376.153,
                z: 4.968
            },

            pixel: null,
            marker: null
        },

        {
            id: "P2",
            name: "Las Venturas",
            role: "Punkt dopasowania",

            world: {
                x: 1088.348,
                y: 1073.993,
                z: 11
            },

            pixel: null,
            marker: null
        },

        {
            id: "P3",
            name: "Los Santos",
            role: "Punkt dopasowania",

            world: {
                x: 1479.507,
                y: -1694.678,
                z: 14.047
            },

            pixel: null,
            marker: null
        },

        {
            id: "P4",
            name: "Blueberry — Red County",
            role: "Punkt kontrolny",

            world: {
                x: 217.733,
                y: 11.723,
                z: 2.571
            },

            pixel: null,
            marker: null
        }

    ];


    // ==========================================
    // 4. ZMIENNE
    // ==========================================

    let imageWidth = 0;
    let imageHeight = 0;

    let imageBounds = null;

    let selectedPointId = null;

    let calibration = null;

    let mapLoaded = false;

    // POPRAWKA: brakująca wcześniej deklaracja.
    let selectedImagePath = null;


    // ==========================================
    // 5. KOMUNIKATY
    // ==========================================

    function setStatus(message) {

        elements.status.textContent = message;

    }


    function setResult(message) {

        elements.result.textContent = message;

    }


    function formatNumber(value, decimals = 2) {

        return Number(value).toFixed(decimals);

    }


    // ==========================================
    // 6. INICJALIZACJA MAPY
    // ==========================================

    const map = L.map("calibration-map", {

        crs: L.CRS.Simple,

        minZoom: -4,
        maxZoom: 3,

        zoomSnap: 0.25,
        zoomDelta: 0.5,

        scrollWheelZoom: true,

        doubleClickZoom: false,

        zoomControl: true,

        keyboard: true,

        dragging: true,
        touchZoom: true,

        maxBoundsViscosity: 0.6

    });


    // ==========================================
    // 7. WYGLĄD PUNKTÓW
    // ==========================================

    function createPointIcon(pointId, isSelected = false) {

        const background = isSelected
            ? "#ffffff"
            : "#65d6a3";

        const color = isSelected
            ? "#102018"
            : "#082017";

        const border = isSelected
            ? "#65d6a3"
            : "#ffffff";

        return L.divIcon({

            className: "calibration-marker-icon",

            html: `
                <div style="
                    width: 32px;
                    height: 32px;

                    display: flex;
                    align-items: center;
                    justify-content: center;

                    background: ${background};
                    color: ${color};

                    border: 3px solid ${border};
                    border-radius: 50%;

                    box-shadow:
                        0 3px 12px rgba(0,0,0,0.45);

                    font-size: 10px;
                    font-weight: 900;
                ">
                    ${pointId}
                </div>
            `,

            iconSize: [32, 32],
            iconAnchor: [16, 16]

        });

    }


    // ==========================================
    // 8. WYŚWIETLANIE LISTY PUNKTÓW
    // ==========================================

    function renderPoints() {

        elements.pointList.innerHTML = "";

        points.forEach((point) => {

            const button = document.createElement(
                "button"
            );

            button.type = "button";

            button.className = "point-button";

            if (selectedPointId === point.id) {
                button.classList.add("active");
            }

            if (point.pixel) {
                button.classList.add("completed");
            }

            const title = document.createElement("div");

            title.className = "point-name";

            const name = document.createElement("span");

            name.textContent =
                point.id + " — " + point.name;

            const state = document.createElement("span");

            state.className = "point-state";

            state.textContent = point.pixel
                ? "ZAPISANO"
                : "OCZEKUJE";

            title.appendChild(name);
            title.appendChild(state);

            const coordinates = document.createElement(
                "div"
            );

            coordinates.className = "point-coordinates";

            coordinates.textContent =
                "X: " + point.world.x +
                " | Y: " + point.world.y +
                " | Z: " + point.world.z;

            const role = document.createElement("div");

            role.className = "point-coordinates";

            role.textContent = point.role;

            button.appendChild(title);
            button.appendChild(coordinates);
            button.appendChild(role);

            button.addEventListener("click", () => {

                selectPoint(point.id);

            });

            elements.pointList.appendChild(button);

        });

        updateButtons();

    }


    // ==========================================
    // 9. WYBÓR PUNKTU
    // ==========================================

    function selectPoint(pointId) {

        const point = points.find(
            item => item.id === pointId
        );

        if (!point) return;

        selectedPointId = pointId;

        renderPoints();

        setStatus(
            "Wybrano " + point.id + " — " +
            point.name +
            ". Teraz kliknij dokładne miejsce tego punktu na mapie."
        );

    }


    // ==========================================
    // 10. AKTUALIZACJA PRZYCISKÓW
    // ==========================================

    function updateButtons() {

        const firstThreeCompleted = points
            .slice(0, 3)
            .every(point => point.pixel !== null);

        elements.calculate.disabled =
            !firstThreeCompleted || !mapLoaded;

        elements.download.disabled =
            calibration === null;

    }


    // ==========================================
    // 11. UNIEWAŻNIENIE POPRZEDNIEJ KALIBRACJI
    // ==========================================

    function invalidateCalibration() {

        calibration = null;

        elements.download.disabled = true;

        setResult(
            "Kalibracja zostanie ponownie obliczona po zebraniu punktów."
        );

    }


    // ==========================================
    // 12. UMIESZCZANIE PUNKTÓW NA OBRAZIE
    // ==========================================

    function placePoint(event) {

        if (!selectedPointId) {

            setStatus(
                "Najpierw wybierz punkt kontrolny po prawej stronie."
            );

            return;
        }

        const point = points.find(
            item => item.id === selectedPointId
        );

        if (!point) return;

        const pixelX = event.latlng.lng;

        const pixelY =
            imageHeight - event.latlng.lat;


        if (
            pixelX < 0 ||
            pixelX > imageWidth ||
            pixelY < 0 ||
            pixelY > imageHeight
        ) {

            setStatus(
                "Kliknij wewnątrz obrazu mapy, nie poza jego granicami."
            );

            return;
        }


        if (point.marker) {

            map.removeLayer(point.marker);

            point.marker = null;

        }


        point.pixel = {

            x: pixelX,
            y: pixelY

        };


        point.marker = L.marker(

            event.latlng,

            {

                icon: createPointIcon(point.id),

                keyboard: false,

                bubblingMouseEvents: false,

                title:
                    point.id + " — " + point.name

            }

        ).addTo(map);


        selectedPointId = null;

        invalidateCalibration();

        renderPoints();

        setStatus(

            "Zapisano " + point.id +
            ". Położenie obrazu: X=" +
            formatNumber(pixelX) +
            ", Y=" +
            formatNumber(pixelY) +
            " px. Wybierz kolejny punkt."

        );

    }


    // ==========================================
    // 13. ROZWIĄZYWANIE UKŁADU RÓWNAŃ
    // ==========================================

    function solve3x3(matrix, values) {

        const augmented = matrix.map(
            (row, index) => [
                row[0],
                row[1],
                row[2],
                values[index]
            ]
        );


        for (let column = 0; column < 3; column++) {

            let pivot = column;

            for (
                let row = column + 1;
                row < 3;
                row++
            ) {

                if (
                    Math.abs(augmented[row][column]) >
                    Math.abs(augmented[pivot][column])
                ) {

                    pivot = row;

                }

            }


            if (
                Math.abs(augmented[pivot][column]) <
                1e-12
            ) {

                throw new Error(
                    "Punkty kontrolne są współliniowe lub zbyt blisko siebie. Nie można obliczyć kalibracji."
                );

            }


            [
                augmented[column],
                augmented[pivot]
            ] = [
                augmented[pivot],
                augmented[column]
            ];


            const divisor =
                augmented[column][column];


            for (
                let j = column;
                j < 4;
                j++
            ) {

                augmented[column][j] /= divisor;

            }


            for (let row = 0; row < 3; row++) {

                if (row === column) continue;

                const factor =
                    augmented[row][column];

                for (
                    let j = column;
                    j < 4;
                    j++
                ) {

                    augmented[row][j] -=
                        factor * augmented[column][j];

                }

            }

        }


        return augmented.map(
            row => row[3]
        );

    }


    // ==========================================
    // 14. TRANSFORMACJA AFINICZNA
    // ==========================================

    function calculateAffineTransform() {

        const fittingPoints = points.slice(0, 3);

        if (
            !fittingPoints.every(
                point => point.pixel !== null
            )
        ) {

            throw new Error(
                "Najpierw zaznacz P1, P2 i P3."
            );

        }


        const p1 = fittingPoints[0].pixel;
        const p2 = fittingPoints[1].pixel;
        const p3 = fittingPoints[2].pixel;


        const triangleArea = Math.abs(

            (p2.x - p1.x) * (p3.y - p1.y) -

            (p3.x - p1.x) * (p2.y - p1.y)

        );


        if (triangleArea < 1) {

            throw new Error(
                "Trzy punkty na obrazie znajdują się zbyt blisko jednej linii. Wybierz ich położenie ponownie."
            );

        }


        const matrix = fittingPoints.map(
            point => [
                point.pixel.x,
                point.pixel.y,
                1
            ]
        );


        const worldX = solve3x3(

            matrix,

            fittingPoints.map(
                point => point.world.x
            )

        );


        const worldY = solve3x3(

            matrix,

            fittingPoints.map(
                point => point.world.y
            )

        );


        return {

            x: worldX,
            y: worldY

        };

    }


    // ==========================================
    // 15. PIKSELE NA WSPÓŁRZĘDNE GRY
    // ==========================================

    function pixelToWorld(pixel, transform) {

        const x =
            transform.x[0] * pixel.x +
            transform.x[1] * pixel.y +
            transform.x[2];

        const y =
            transform.y[0] * pixel.x +
            transform.y[1] * pixel.y +
            transform.y[2];

        return {

            x,
            y

        };

    }


    // ==========================================
    // 16. WSPÓŁRZĘDNE GRY NA PIKSELE
    // ==========================================

    function worldToPixel(world, transform) {

        const a = transform.x[0];
        const b = transform.x[1];

        const d = transform.y[0];
        const e = transform.y[1];

        const c = transform.x[2];
        const f = transform.y[2];


        const determinant =
            a * e - b * d;


        if (
            Math.abs(determinant) <
            1e-15
        ) {

            throw new Error(
                "Nie można odwrócić obliczonej transformacji."
            );

        }


        const dx = world.x - c;
        const dy = world.y - f;


        return {

            x: (
                e * dx - b * dy
            ) / determinant,

            y: (
                -d * dx + a * dy
            ) / determinant

        };

    }


    // ==========================================
    // 17. OBLICZANIE KALIBRACJI
    // ==========================================

    function calculateCalibration() {

        try {

            const transform =
                calculateAffineTransform();


            const validationPoint =
                points.find(
                    point => point.id === "P4"
                );


            let validation = null;


            if (validationPoint.pixel) {

                const predictedWorld =
                    pixelToWorld(
                        validationPoint.pixel,
                        transform
                    );


                const expectedWorld =
                    validationPoint.world;


                const errorX =
                    predictedWorld.x -
                    expectedWorld.x;

                const errorY =
                    predictedWorld.y -
                    expectedWorld.y;


                const errorWorldUnits =
                    Math.hypot(
                        errorX,
                        errorY
                    );


                const expectedPixel =
                    worldToPixel(
                        expectedWorld,
                        transform
                    );


                const errorPixels =
                    Math.hypot(

                        expectedPixel.x -
                        validationPoint.pixel.x,

                        expectedPixel.y -
                        validationPoint.pixel.y

                    );


                validation = {

                    pointId: "P4",

                    pointName:
                        validationPoint.name,

                    expectedWorld: {
                        x: expectedWorld.x,
                        y: expectedWorld.y
                    },

                    predictedWorld: {
                        x: predictedWorld.x,
                        y: predictedWorld.y
                    },

                    errorX,
                    errorY,

                    errorWorldUnits,

                    expectedPixel,

                    actualPixel:
                        validationPoint.pixel,

                    errorPixels

                };

            }


            calibration = {

                version: 1,

                coordinateSystem:
                    "GTA San Andreas world coordinates",

                image: {

                    path: selectedImagePath,

                    width: imageWidth,

                    height: imageHeight,

                    pixelOrigin:
                        "top-left",

                    pixelYAxis:
                        "increases-downward"

                },

                transformation: {

                    type:
                        "affine",

                    description:
                        "GameX = a*pixelX + b*pixelY + c; GameY = d*pixelX + e*pixelY + f",

                    gameX:
                        transform.x,

                    gameY:
                        transform.y

                },

                controlPoints: points.map(
                    point => ({

                        id: point.id,

                        name: point.name,

                        role: point.role,

                        world: {
                            ...point.world
                        },

                        pixel: point.pixel
                            ? { ...point.pixel }
                            : null

                    })
                ),

                validation,

                createdAt:
                    new Date().toISOString()

            };


            elements.download.disabled = false;


            const equationX =
                "X = " +
                formatNumber(transform.x[0], 9) +
                " × px + " +
                formatNumber(transform.x[1], 9) +
                " × py + " +
                formatNumber(transform.x[2], 6);


            const equationY =
                "Y = " +
                formatNumber(transform.y[0], 9) +
                " × px + " +
                formatNumber(transform.y[1], 9) +
                " × py + " +
                formatNumber(transform.y[2], 6);


            const lines = [

                "KALIBRACJA OBLICZONA",

                "",

                "Transformacja wykorzystuje P1, P2 i P3.",

                "",

                "RÓWNANIE X:",

                equationX,

                "",

                "RÓWNANIE Y:",

                equationY

            ];


            if (validation) {

                lines.push(

                    "",

                    "KONTROLA NIEZALEŻNA — P4",

                    "Obszar: " +
                        validation.pointName,

                    "",

                    "Oczekiwane X: " +
                        formatNumber(
                            validation.expectedWorld.x,
                            3
                        ),

                    "Obliczone X: " +
                        formatNumber(
                            validation.predictedWorld.x,
                            3
                        ),

                    "Oczekiwane Y: " +
                        formatNumber(
                            validation.expectedWorld.y,
                            3
                        ),

                    "Obliczone Y: " +
                        formatNumber(
                            validation.predictedWorld.y,
                            3
                        ),

                    "",

                    "Różnica w świecie gry: " +
                        formatNumber(
                            validation.errorWorldUnits,
                            3
                        ) +
                        " jednostek",

                    "Różnica na obrazie: " +
                        formatNumber(
                            validation.errorPixels,
                            2
                        ) +
                        " pikseli"

                );

            } else {

                lines.push(

                    "",

                    "P4 nie został jeszcze zaznaczony.",

                    "Kalibracja nie ma niezależnej kontroli dokładności."

                );

            }


            lines.push(

                "",

                "To wynik matematyczny, nie potwierdzenie dokładności mapy. Ostateczną ocenę wykonamy na podstawie różnicy P4."

            );


            setResult(lines.join("\n"));


            setStatus(

                validation

                    ? "Obliczenia zakończone. P4 został wykorzystany jako niezależny test."

                    : "Wstępna transformacja obliczona. Zaznacz P4, aby sprawdzić jej dokładność."

            );


            updateButtons();


        } catch (error) {

            calibration = null;

            updateButtons();

            setStatus(
                "Nie udało się obliczyć kalibracji."
            );

            setResult(error.message);

            console.error(
                "Błąd kalibracji:",
                error
            );

        }

    }


    // ==========================================
    // 18. EKSPORT JSON
    // ==========================================

    function downloadCalibration() {

        if (!calibration) {

            setStatus(
                "Najpierw oblicz kalibrację."
            );

            return;

        }


        const json = JSON.stringify(
            calibration,
            null,
            4
        );


        const blob = new Blob(

            [json],

            {
                type: "application/json"
            }

        );


        const url =
            URL.createObjectURL(blob);


        const anchor =
            document.createElement("a");


        anchor.href = url;

        anchor.download =
            "sa-event-maps-calibration.json";


        document.body.appendChild(anchor);

        anchor.click();

        anchor.remove();


        URL.revokeObjectURL(url);


        setStatus(
            "Plik kalibracji został przygotowany do pobrania."
        );

    }


    // ==========================================
    // 19. RESET KALIBRACJI
    // ==========================================

    function resetCalibration() {

        points.forEach((point) => {

            if (point.marker) {

                map.removeLayer(point.marker);

                point.marker = null;

            }

            point.pixel = null;

        });


        selectedPointId = null;

        calibration = null;


        renderPoints();


        setResult(
            "Wszystkie punkty zostały wyczyszczone."
        );


        setStatus(
            "Kalibracja wyczyszczona. Wybierz P1, aby rozpocząć ponownie."
        );


        updateButtons();

    }


    // ==========================================
    // 20. PRZYCISKI
    // ==========================================

    elements.calculate.addEventListener(
        "click",
        calculateCalibration
    );


    elements.download.addEventListener(
        "click",
        downloadCalibration
    );


    elements.reset.addEventListener(
        "click",
        resetCalibration
    );


    // ==========================================
    // 21. KLIKNIĘCIE MAPY
    // ==========================================

    map.on("click", (event) => {

        placePoint(event);

    });


    // ==========================================
    // 22. WCZYTYWANIE OBRAZU
    // ==========================================

    function loadMapImage(index) {

        if (
            index >=
            MAP_IMAGE_CANDIDATES.length
        ) {

            elements.dimensions.textContent =
                "Nie znaleziono obrazu.";

            setStatus(
                "Nie udało się odnaleźć mapy gtasa-map-shadows. Sprawdź dokładną nazwę pliku i jego rozszerzenie w folderze assets."
            );

            console.error(
                "Nie znaleziono mapy:",
                MAP_IMAGE_CANDIDATES
            );

            return;

        }


        const imagePath =
            MAP_IMAGE_CANDIDATES[index];


        const image = new Image();


        image.onload = () => {

            // Zapisujemy ścieżkę do odnalezionego obrazu.

            selectedImagePath = imagePath;

            imageWidth =
                image.naturalWidth;

            imageHeight =
                image.naturalHeight;


            if (
                !imageWidth ||
                !imageHeight
            ) {

                loadMapImage(index + 1);

                return;

            }


            elements.dimensions.textContent =
                imageWidth +
                " × " +
                imageHeight +
                " px";


            imageBounds = [

                [0, 0],

                [imageHeight, imageWidth]

            ];


            L.imageOverlay(

                selectedImagePath,

                imageBounds,

                {
                    alt:
                        "Mapa GTA San Andreas z cieniami"
                }

            ).addTo(map);


            const allowedBounds =
                L.latLngBounds(

                    [
                        [
                            -imageHeight * 0.25,
                            -imageWidth * 0.25
                        ],

                        [
                            imageHeight * 1.25,
                            imageWidth * 1.25
                        ]
                    ]

                );


            map.setMaxBounds(
                allowedBounds
            );


            requestAnimationFrame(() => {

                map.invalidateSize();

                map.fitBounds(
                    imageBounds,
                    {
                        padding: [15, 15]
                    }
                );

                mapLoaded = true;

                setStatus(
                    "Mapa załadowana. Wybierz P1 — San Fierro, aby rozpocząć kalibrację."
                );

                renderPoints();

            });


            console.log(
                "Kalibrator załadował mapę:",
                selectedImagePath,
                imageWidth,
                imageHeight
            );

        };


        image.onerror = () => {

            console.log(
                "Nie znaleziono wariantu:",
                imagePath
            );

            loadMapImage(index + 1);

        };


        image.src = imagePath;

    }


    // ==========================================
    // 23. START APLIKACJI
    // ==========================================

    renderPoints();

    loadMapImage(0);


    console.log(
        "SA Event Maps — silnik kalibracyjny uruchomiony."
    );

})();
