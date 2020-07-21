// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
package main

import (
        "database/sql"
        "fmt"
        "log"
        "net/http"
        "os"

        _ "github.com/jackc/pgx/stdlib"
)

// queryBasic demonstrates issuing a query and reading results.
func dropoffsHandler(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-type", "application/json")
        centerLat := r.FormValue("centerLat")
        centerLng := r.FormValue("centerLng")
        geoJSON, err := getGeoJSONFromDatabase(centerLat, centerLng)
	if err != nil {
		str := fmt.Sprintf("Couldn't encode results: %s", err)
		http.Error(w, str, 500)
		return
	}
        fmt.Fprintf(w, geoJSON)
}


// The connection pool
var db *sql.DB

// Each struct instance contains a single row from the query result.
type result struct {
	featureCollection string
}
func initConnectionPool() {
	// If the optional DB_TCP_HOST environment variable is set, it contains
	// the IP address and port number of a TCP connection pool to be created,
	// such as "127.0.0.1:5432". If DB_TCP_HOST is not set, a Unix socket
	// connection pool will be created instead.
	if os.Getenv("DB_TCP_HOST") != "" {
		var (
				dbUser    = mustGetenv("DB_USER")
				dbPwd     = mustGetenv("DB_PASS")
				dbTCPHost = mustGetenv("DB_TCP_HOST")
				dbPort    = mustGetenv("DB_PORT")
				dbName    = mustGetenv("DB_NAME")
		)

		var dbURI string
		dbURI = fmt.Sprintf("host=%s user=%s password=%s port=%s database=%s", dbTCPHost, dbUser, dbPwd, dbPort, dbName)

		// dbPool is the pool of database connections.
		dbPool, err := sql.Open("pgx", dbURI)
		if err != nil {
			dbPool = nil
			log.Fatalf("sql.Open: %v", err)
			return
		}

		configureConnectionPool(dbPool)

		if err != nil {
			log.Fatalf("initConnectionPool: unable to connect: %s", err)
			return
		}
		db = dbPool
	}
}

// configureConnectionPool sets database connection pool properties.
// For more information, see https://golang.org/pkg/database/sql
func configureConnectionPool(dbPool *sql.DB) {
	// Set maximum number of connections in idle connection pool.
	dbPool.SetMaxIdleConns(5)
	// Set maximum number of open connections to the database.
	dbPool.SetMaxOpenConns(7)
	// Set Maximum time (in seconds) that a connection can remain open.
	dbPool.SetConnMaxLifetime(1800)
}

// mustGetEnv is a helper function for getting environment variables.
// Displays a warning if the environment variable is not set.
func mustGetenv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("Warning: %s environment variable not set.\n", k)
	}
	return v
}
func getGeoJSONFromDatabase(centerLat string, centerLng string) (string, error) {

	// Obviously you can one-line this, but for testing purposes let's make it easy to modify on the fly.
	const milesRadius = 10
	const milesToMeters = 1609
	const radiusInMeters = milesRadius * milesToMeters

	const tableName = "austinrecycling"

	var queryStr = fmt.Sprintf(
		`SELECT jsonb_build_object(
			'type',
			'FeatureCollection',
			'features',
			jsonb_agg(feature)
		)
		FROM (
			SELECT jsonb_build_object(
				'type',
				'Feature',
				'id',
				ogc_fid,
				'geometry',
				ST_AsGeoJSON(wkb_geometry)::jsonb,
				'properties',
				to_jsonb(row) - 'ogc_fid' - 'wkb_geometry'
			) AS feature
			FROM (
				SELECT *,
					ST_Distance(
						ST_GEOGFromWKB(wkb_geometry),
						-- Los Angeles (LAX)
						ST_GEOGFromWKB(st_makepoint(%v, %v))
					) as distance
				from %v
				order by distance
				limit 25
			) row
			where distance < %v
		) features
		`, centerLng, centerLat, tableName, radiusInMeters)

	rows, err := db.Query(queryStr)

	defer rows.Close()

	rows.Next()
	queryResult := result{}
	err = rows.Scan(&queryResult.featureCollection)
	return queryResult.featureCollection, err
}