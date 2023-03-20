/* 'use strict'; */

var MYTIMEOUT = 20000;

var isWindows = /Windows /.test(navigator.userAgent); // Windows
var isAndroid = !isWindows && /Android/.test(navigator.userAgent);

var pluginScenarioList = [
  isAndroid ? 'Plugin-implementation-default' : 'Plugin',
  'Plugin-implementation-2'
];

// FUTURE TBD
// var pluginScenarioCount = isAndroid ? 2 : 1;
var pluginScenarioCount = 1;

var mytests = function() {

  for (var i=0; i<pluginScenarioCount; ++i) {

    describe(pluginScenarioList[i] + ': attach / detach db test(s)', function() {
      var scenarioName = pluginScenarioList[i];
      var suiteName = scenarioName + ': ';
      // FUTURE TBD
      // var isImpl2 = (i === 1);

      it(suiteName + 'preliminary cleanup 1',
        function(done) {
          expect(true).toBe(true);
          window.sqlitePlugin.deleteDatabase({ name: 'attach-test-external.db', iosDatabaseLocation: 'Library' }, done, done);
        }, MYTIMEOUT);

      it(suiteName + 'preliminary cleanup 2',
        function(done) {
          expect(true).toBe(true);
          window.sqlitePlugin.deleteDatabase({ name: 'attach-test.db', iosDatabaseLocation: 'Library' }, done, done);
        }, MYTIMEOUT);

      it(suiteName + 'ATTACH/PRAGMA database_list/DETACH test',
        function(done) {
          window.sqlitePlugin.openDatabase({
            name: 'attach-test-external.db',
            iosDatabaseLocation: 'Library'
          }, function(db1) {
          db1.transaction(function(tx) {
            tx.executeSql('DROP TABLE IF EXISTS tt');
            tx.executeSql('CREATE TABLE tt (tv TEXT)');
            tx.executeSql('INSERT INTO tt VALUES (?)', ['test']);
          }, function(err) {
            expect(false).toBe(true);
            done();
          }, function() {

            db1.close(function() {

              window.sqlitePlugin.openDatabase({
                name: 'attach-test.db',
                location: 'default',
              }, function(db2) {
                db2.attach({ name: 'attach-test-external.db', iosDatabaseLocation: 'Library', as: 'ext', }, function() {
                  db2.executeSql('SELECT * from ext.tt', [], function(res) {
                    expect(res).toBeDefined();
                    expect(res.rows).toBeDefined();
                    expect(res.rows.length).toBe(1);
                    expect(res.rows.item(0).tv).toBeDefined();
                    expect(res.rows.item(0).tv).toBe('test');

                    db2.executeSql('PRAGMA database_list', [], function(res) {
                      expect(res.rows.length).toBe(2);
                      expect(res.rows.item(0).name).toBe('main');
                      expect(res.rows.item(1).name).toBe('ext');
                      expect(res.rows.item(1).file).toBeDefined();
                      expect(res.rows.item(1).file.indexOf('attach-test-external.db') >= 0).toBe(true);

                      db2.detach('ext', function() {
                        db2.executeSql('PRAGMA database_list', [], function(res) {
                          expect(res.rows.length).toBe(1);
                          expect(res.rows.item(0).name).toBe('main');

                          done();
                        }, function(err) {
                          expect(false).toBe(true);
                          expect(JSON.stringify(err)).toBe('');
                          done();
                        });
                      }, function(err) {
                        expect(false).toBe(true);
                        expect(JSON.stringify(err)).toBe('');
                        done();
                      });
                    }, function(err) {
                      expect(false).toBe(true);
                      expect(JSON.stringify(err)).toBe('');
                      done();
                    });
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
            });
          });
          });

        }, MYTIMEOUT);

    });

  }

}

if (window.hasBrowser) mytests();
else exports.defineAutoTests = mytests;

/* vim: set expandtab : */
