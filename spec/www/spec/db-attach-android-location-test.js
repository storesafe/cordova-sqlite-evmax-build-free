/* 'use strict'; */

var MYTIMEOUT = 20000;

var isWindows = /Windows /.test(navigator.userAgent); // Windows
var isAndroid = !isWindows && /Android/.test(navigator.userAgent);

var pluginScenarioList = [
  isAndroid ? 'Plugin-implementation-default' : 'Plugin',
  'Plugin-implementation-2'
];

//var pluginScenarioCount = isAndroid ? 2 : 1;
var pluginScenarioCount = 1;

var mytests = function() {

  for (var i=0; i<pluginScenarioCount; ++i) {

    describe(pluginScenarioList[i] + ': attach Android db location test(s)', function() {
      var scenarioName = pluginScenarioList[i];
      var suiteName = scenarioName + ': ';
      // FUTURE TBD
      //var isImpl2 = (i === 1);

        it(suiteName + 'Create db file in Documents, check size, copy to default location, check copy, and delete original', function(done) {
          if (!isAndroid) pending('SKIP for iOS/macOS/Windows ...');

          var dbname = 'attach-db-in-documents-test.db';

          window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function(dataDirectoryEntry) {
            expect(dataDirectoryEntry).toBeDefined();

            expect(dataDirectoryEntry.isDirectory).toBe(true);

            dataDirectoryEntry.getDirectory('Documents', null, function(documentsDirectoryEntry) {
              expect(documentsDirectoryEntry).toBeDefined();
              expect(documentsDirectoryEntry.isDirectory).toBe(true);

              var createDatabaseDirectoryEntry = documentsDirectoryEntry;
              var db = window.sqlitePlugin.openDatabase({name: dbname, androidDatabaseLocation: createDatabaseDirectoryEntry.toURL()});

              db.transaction(function(tx) {
                tx.executeSql('DROP TABLE IF EXISTS tt');
                tx.executeSql('CREATE TABLE tt (tv)');
                tx.executeSql('INSERT INTO tt VALUES (?)', ['test-value']);

              }, function(error) {
                // NOT EXPECTED:
                expect(false).toBe(true);
                expect(JSON.stringify(error)).toBe('---');
                // Close (PLUGIN) & finish:
                db.close(done, done);

              }, function() {
                db.close(function() {

              window.sqlitePlugin.openDatabase({
                name: 'attach-location-test.db',
                location: 'default',
                androidDatabaseImplementation: 2,
              }, function(db2) {
                db2.attach({ name: dbname, androidDatabaseLocation: createDatabaseDirectoryEntry.toURL(), as: 'ext' }, function() {
                  db2.executeSql('SELECT * from ext.tt', [], function(res) {
                    expect(res).toBeDefined();
                    expect(res.rows).toBeDefined();
                    expect(res.rows.length).toBe(1);
                    expect(res.rows.item(0).tv).toBeDefined();
                    expect(res.rows.item(0).tv).toBe('test-value');

                    done();
                  }, function(err) {
                    expect(false).toBe(true);
                    expect(JSON.stringify(err)).toBe('');
                    done();
                  });
                }, function(err) {
                  expect(false).toBe(true);
                  expect(err.message).toBe('--');
                  done();
                });
              });


                }, function(error) {
                  // NOT EXPECTED:
                  expect(false).toBe(true);
                  expect(JSON.stringify(error)).toBe('---');
                  done();
                });
              });

            }, function(error) {
              // NOT EXPECTED:
              expect(false).toBe(true);
              expect(JSON.stringify(error)).toBe('---');
              done();
            });

          }, function(error) {
            // NOT EXPECTED:
            expect(false).toBe(true);
            expect(JSON.stringify(error)).toBe('---');
            done();
          });

        }, MYTIMEOUT);

    });

  }

}

if (window.hasBrowser) mytests();
else exports.defineAutoTests = mytests;

/* vim: set expandtab : */
