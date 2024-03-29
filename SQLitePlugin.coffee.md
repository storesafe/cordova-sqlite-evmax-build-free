# SQLite plugin in Markdown (litcoffee)

    ###
    License for this version: GPL v3 (http://www.gnu.org/licenses/gpl.txt) or commercial license.
    Contact for commercial license: sales@litehelpers.net
    ###

#### Use coffee compiler to compile this directly into Javascript

# Top-level SQLite plugin objects

## root window object:

    root = @

## constant(s):

    READ_ONLY_REGEX = /^(\s|;)*(?:alter|create|delete|drop|insert|reindex|replace|update)/i

    # per-db state
    DB_STATE_INIT = "INIT"
    DB_STATE_OPEN = "OPEN"

    EE_SIZE_LIMIT = 16 * 1024 * 1024

    REPLACE_BANG_REGEXP = /!/g
    REPLACE_SLASH_REGEXP = /\//g

## global(s):

    # per-db map of locking and queueing
    # XXX NOTE: This is NOT cleaned up when a db is closed and/or deleted.
    # If the record is simply removed when a db is closed or deleted,
    # it will cause some test failures and may break large-scale
    # applications that repeatedly open and close the database.
    # [BUG #210] TODO: better to abort and clean up the pending transaction state.
    # XXX TBD this will be renamed and include some more per-db state.
    # NOTE: In case txLocks is renamed or replaced the selfTest has to be adapted as well.
    txLocks = {}

## utility functions:

    # Errors returned to callbacks must conform to `SqlError` with a code and message.
    # Some errors are of type `Error` or `string` and must be converted.
    newSQLError = (error, code) ->
      sqlError = error
      code = 0 if !code # unknown by default

      if !sqlError
        sqlError = new Error "a plugin had an error but provided no response"
        sqlError.code = code

      if typeof sqlError is "string"
        sqlError = new Error error
        sqlError.code = code

      if !sqlError.code && sqlError.message
        sqlError.code = code

      if !sqlError.code && !sqlError.message
        sqlError = new Error "an unknown error was returned: " + JSON.stringify(sqlError)
        sqlError.code = code

      return sqlError

    nextTick = window.setImmediate || (fun) ->
      window.setTimeout(fun, 0)
      return

    ###
      Utility that avoids leaking the arguments object. See
      https://www.npmjs.org/package/argsarray
    ###
    argsArray = (fun) ->
      return ->
        len = arguments.length
        if len
          args = []
          i = -1
          while ++i < len
            args[i] = arguments[i]
          return fun.call this, args
        else
          return fun.call this, []

## SQLite plugin db-connection handle

#### NOTE: there can be multipe SQLitePlugin db-connection handles per open db.

#### SQLite plugin db connection handle object is defined by a constructor function and prototype member functions:

    SQLitePlugin = (openargs, openSuccess, openError) ->
      # console.log "SQLitePlugin openargs: #{JSON.stringify openargs}"

      # SHOULD already be checked by openDatabase:
      if !(openargs and openargs['name'])
        throw newSQLError "Cannot create a SQLitePlugin db instance without a db name"

      dbname = openargs.name

      if typeof dbname != 'string'
        throw newSQLError 'sqlite plugin database name must be a string'

      @openargs = openargs
      @dbname = dbname

      @openSuccess = openSuccess
      @openError = openError

      @openSuccess or
        @openSuccess = ->
          console.log "DB opened: " + dbname
          return

      @openError or
        @openError = (e) ->
          console.log e.message
          return

      @open @openSuccess, @openError
      return

    SQLitePlugin::databaseFeatures = isSQLitePluginDatabase: true

    # Keep track of state of open db connections
    # XXX FUTURE TBD this *may* be moved and renamed,
    # or even combined with txLocks if possible.
    # NOTE: In case txLocks is renamed or replaced the selfTest has to be adapted as well.
    SQLitePlugin::openDBs = {}

    SQLitePlugin::dbidmap = {}
    SQLitePlugin::fjmap = {}

    SQLitePlugin::addTransaction = (t) ->
      if !txLocks[@dbname]
        txLocks[@dbname] = {
          queue: []
          inProgress: false
        }
      txLocks[@dbname].queue.push t
      if @dbname of @openDBs && @openDBs[@dbname] isnt DB_STATE_INIT
        # FUTURE TBD: rename startNextTransaction to something like
        # triggerTransactionQueue
        # ALT TBD: only when queue has length of 1 (and test)??
        @startNextTransaction()

      else
        if @dbname of @openDBs
          console.log 'new transaction is queued, waiting for open operation to finish'
        else
          # XXX SHOULD NOT GET HERE.
          # FUTURE TBD TODO: in this exceptional case abort and discard the transaction.
          console.log 'database is closed, new transaction is [stuck] waiting until db is opened again!'
      return

    SQLitePlugin::transaction = (fn, error, success) ->
      # FUTURE TBD check for valid fn here
      if !@openDBs[@dbname]
        error newSQLError 'database not open'
        return

      @addTransaction new SQLitePluginTransaction(this, fn, error, success, true, false)
      return

    SQLitePlugin::readTransaction = (fn, error, success) ->
      # FUTURE TBD check for valid fn here (and add test for this)
      if !@openDBs[@dbname]
        error newSQLError 'database not open'
        return

      @addTransaction new SQLitePluginTransaction(this, fn, error, success, false, true)
      return

    SQLitePlugin::startNextTransaction = ->
      self = @

      nextTick =>
        if !(@dbname of @openDBs) || @openDBs[@dbname] isnt DB_STATE_OPEN
          console.log 'cannot start next transaction: database not open'
          return

        txLock = txLocks[self.dbname]
        if !txLock
          console.log 'cannot start next transaction: database connection is lost'
          # XXX TBD TODO (BUG #210/??): abort all pending transactions with error cb [and test!!]
          # @abortAllPendingTransactions()
          return

        else if txLock.queue.length > 0 && !txLock.inProgress
          # start next transaction in q
          txLock.inProgress = true
          txLock.queue.shift().start()
        return

      return

    SQLitePlugin::abortAllPendingTransactions = ->
      # extra debug info:
      # if txLocks[@dbname] then console.log 'abortAllPendingTransactions with transaction queue length: ' + txLocks[@dbname].queue.length
      # else console.log 'abortAllPendingTransactions with no transaction lock state'

      txLock = txLocks[@dbname]
      if !!txLock && txLock.queue.length > 0
        # XXX TODO: what to do in case there is a (stray) transaction in progress?
        #console.log 'abortAllPendingTransactions - cleanup old transaction(s)'
        for tx in txLock.queue
          tx.abortFromQ newSQLError 'Invalid database handle'

        # XXX TODO: consider cleaning up (delete) txLocks[@dbname] resource,
        # in case it is known there are no more pending transactions
        txLock.queue = []
        txLock.inProgress = false

      return

    SQLitePlugin::open = (success, error) ->
      if @dbname of @openDBs
        console.log 'database already open: ' + @dbname

        @dbid = @dbidmap[@dbname]

        # for a re-open run the success cb async so that the openDatabase return value
        # can be used in the success handler as an alternative to the handler's
        # db argument
        nextTick =>
          success @
          return

        # (done)

      else
        # openDatabase step 1:
        console.log 'OPEN database: ' + @dbname

        opensuccesscb = (fjinfo) =>
          # NOTE: the db state is NOT stored (in @openDBs) if the db was closed or deleted.
          console.log 'OPEN database: ' + @dbname + ' - OK'

          # distinguish use of flat JSON batch sql interface
          if !!fjinfo and !!fjinfo.dbid
            console.log 'Detected Android/iOS/macOS platform version with flat JSON interface'
            @dbidmap[@dbname] = @dbid = fjinfo.dbid
            @fjmap[@dbname] = true

          #if !@openDBs[@dbname] then call open error cb, and abort pending tx if any
          if !@openDBs[@dbname]
            console.log 'database was closed during open operation'
            # XXX TODO (WITH TEST) ref BUG litehelpers/Cordova-sqlite-storage#210:
            # if !!error then error newSQLError 'database closed during open operation'
            # @abortAllPendingTransactions()

          if @dbname of @openDBs
            @openDBs[@dbname] = DB_STATE_OPEN

          if !!success then success @

          txLock = txLocks[@dbname]
          if !!txLock && txLock.queue.length > 0 && !txLock.inProgress
            @startNextTransaction()
          return

        openerrorcb = =>
          console.log 'OPEN database: ' + @dbname + ' FAILED, aborting any pending transactions'
          # XXX TODO: newSQLError missing the message part!
          if !!error then error newSQLError 'Could not open database'
          delete @openDBs[@dbname]
          delete @dbidmap[@dbname]
          delete @fjmap[@dbname]
          @abortAllPendingTransactions()
          return

        # store initial DB state:
        @openDBs[@dbname] = DB_STATE_INIT
        @dbidmap[@dbname] = @dbid = null
        @fjmap[@dbname] = false

        # UPDATED WORKAROUND SOLUTION to cordova-sqlite-storage BUG 666:
        # Request to native side to close existing database
        # connection in case it is already open.
        # Wait for callback before opening the database
        # (ignore close error).
        step2 = =>
          cordova.exec opensuccesscb, openerrorcb, "SQLitePlugin", "open", [ @openargs ]
          return

        cordova.exec step2, step2, 'SQLitePlugin', 'close', [ { path: @dbname } ]

      return

    SQLitePlugin::close = (success, error) ->
      if @dbname of @openDBs
        if txLocks[@dbname] && txLocks[@dbname].inProgress
          # FUTURE TBD TODO ref BUG litehelpers/Cordova-sqlite-storage#210:
          # Wait for current tx to finish then close,
          # then abort any other pending transactions
          # (and cleanup any other internal resources).
          # (This would need testing!!)
          console.log 'cannot close: transaction is in progress'
          error newSQLError 'database cannot be closed while a transaction is in progress'
          return

        console.log 'CLOSE database: ' + @dbname

        # NOTE: closing one db handle disables other handles to same db
        # FUTURE TBD TODO ref litehelpers/Cordova-sqlite-storage#210:
        # Add a dispose method to simply invalidate the
        # current database object ("this")
        delete @openDBs[@dbname]

        if txLocks[@dbname] then console.log 'closing db with transaction queue length: ' + txLocks[@dbname].queue.length
        else console.log 'closing db with no transaction lock state'

        # XXX TODO BUG litehelpers/Cordova-sqlite-storage#210:
        # abort all pending transactions (with error callback)
        # when closing a database (needs testing!!)
        # (and cleanup any other internal resources)

        cordova.exec success, error, "SQLitePlugin", "close", [ { path: @dbname } ]

      else
        console.log 'cannot close: database is not open'
        if error then nextTick -> error()

      return

    SQLitePlugin::executeSql = (statement, params, success, error) ->
      # XXX TODO: better to capture the result, and report it once
      # the transaction has completely finished.
      # This would fix BUG #204 (cannot close db in db.executeSql() callback).
      mysuccess = (t, r) -> if !!success then success r
      myerror = (t, e) -> if !!error then error e

      myfn = (tx) ->
        tx.addStatement(statement, params, mysuccess, myerror)
        return

      @addTransaction new SQLitePluginTransaction(this, myfn, null, null, false, false)
      return

    SQLitePlugin::sqlBatch = (sqlStatements, success, error) ->
      if !sqlStatements || sqlStatements.constructor isnt Array
        throw newSQLError 'sqlBatch expects an array'

      ss = sqlStatements.slice(0)

      f = (tx) ->
        for s in ss
          if s.constructor is Array
            if s.length is 0
              throw newSQLError 'sqlBatch array element of zero (0) length'

            tx.addStatement s[0],
              (if s.length is 0 then [] else s[1]), null, null

          else
            tx.addStatement s, [], null, null

      @addTransaction new SQLitePluginTransaction(this, f, error, success, true, false)
      return

## SQLite plugin transaction object for batching:

    SQLitePluginTransaction = (db, fn, error, success, txlock, readOnly) ->
      # FUTURE TBD check this earlier:
      if typeof(fn) != "function"
        ###
        This is consistent with the implementation in Chrome -- it
        throws if you pass anything other than a function. This also
        prevents us from stalling our txQueue if somebody passes a
        false value for fn.
        ###
        throw newSQLError "transaction expected a function"

      @db = db
      @fn = fn
      @error = error
      @success = success
      @txlock = txlock
      @readOnly = readOnly

      @flatExecutesEntries = []
      @eCount = 0
      @eeSize = 0
      @executeCallbacks = []

      if txlock
        @addStatement "BEGIN", [], null, (tx, err) ->
          throw newSQLError "unable to begin transaction: " + err.message, err.code

      # Workaround for litehelpers/Cordova-sqlite-storage#409
      # extra statement in case user function does not add any SQL statements
      # TBD This also adds an extra statement to db.executeSql()
      else
        @addStatement "SELECT 1", [], null, null

      return

    SQLitePluginTransaction::start = ->
      try
        @fn this

        @run()

      catch err
        # If "fn" throws, we must report the whole transaction as failed.
        txLocks[@db.dbname].inProgress = false
        @db.startNextTransaction()
        if @error
          @error newSQLError err

      return

    SQLitePluginTransaction::executeSql = (sql, values, success, error) ->

      if @finalized
        throw {message: 'InvalidStateError: DOM Exception 11: This transaction is already finalized. Transactions are committed after its success or failure handlers are called. If you are using a Promise to handle callbacks, be aware that implementations following the A+ standard adhere to run-to-completion semantics and so Promise resolution occurs on a subsequent tick and therefore after the transaction commits.', code: 11}
        return

      if @readOnly && READ_ONLY_REGEX.test(sql)
        @handleStatementFailure(error, {message: 'invalid sql for a read-only transaction'})
        return

      @addStatement(sql, values, success, error)

      return

    # This method adds the SQL statement to the transaction queue but does not check for
    # finalization since it is used to execute COMMIT and ROLLBACK.
    SQLitePluginTransaction::addStatement = (sql, values, success, error) ->
      sqlStatement = if typeof sql is 'string'
        sql
      else
        sql.toString()

      ee = sql.length + 16 +
        if !!values && values.constructor == Array
          values.join().length + 4 * values.length
        else
          0

      if @flatExecutesEntries.length is 0 or @eeSize + ee > EE_SIZE_LIMIT
        e = []
        e.flen = 0
        @flatExecutesEntries.push e
        @eeSize = 0

      flatlist = @flatExecutesEntries.slice(-1)[0]

      ++flatlist.flen
      ++@eCount

      @eeSize += ee

      flatlist.push sqlStatement

      if !!values && values.constructor == Array
        flatlist.push values.length
        for v in values
          t = typeof v
          flatlist.push(
            if v == null || v == undefined then null
            else if t == 'number' || t == 'string' then v
            else v.toString()
          )

      else
        flatlist.push 0

      @executeCallbacks.push
        success: success
        error: error

      return

    SQLitePluginTransaction::handleStatementSuccess = (handler, response) ->
      if !handler
        return

      rows = response.rows || []
      payload =
        rows:
          item: (i) ->
            rows[i]

          length: rows.length

        rowsAffected: response.rowsAffected or 0
        insertId: response.insertId or undefined

      handler this, payload

      return

    SQLitePluginTransaction::handleStatementFailure = (handler, response) ->
      if !handler
        throw newSQLError "a statement with no error handler failed: " + response.message, response.code
      if handler(this, response) isnt false
        throw newSQLError "a statement error callback did not return false: " + response.message, response.code
      return

    SQLitePluginTransaction::run = ->
      # persist for handlerFor callbacks:
      txFailure = null

      # sql statements from queue:
      flatBatchExecutesEntries = @flatExecutesEntries
      batchExecuteCallbacks = @executeCallbacks

      # XXX NOTE: If this length is zero it will not work.
      # Workaround is applied in the constructor.
      # FUTURE TBD: It would be better to fix the problem here.

      waiting = @eCount

      @flatExecutesEntries = []
      @eCount = 0
      @eeSize = 0
      @executeCallbacks = []

      # my tx object (this)
      tx = @

      # FUTURE TBD factor this out in favor of a more elegant solution?
      handlerFor = (index, didSucceed) ->
        (response) ->
          if !txFailure
            try
              if didSucceed
                tx.handleStatementSuccess batchExecuteCallbacks[index].success, response
              else
                tx.handleStatementFailure batchExecuteCallbacks[index].error, newSQLError(response)
            catch err
              # NOTE: txFailure is expected to be null at this point.
              txFailure = newSQLError(err)

          if --waiting == 0
            if txFailure
              tx.flatExecutesEntries = []
              tx.eCount = 0
              tx.eeSize = 0
              tx.executeCallbacks = []

              tx.$abort txFailure
            else if tx.flatExecutesEntries.length > 0
              # new requests have been issued by the callback
              # handlers, so run another batch.
              tx.run()
            else
              tx.$finish()

          return

      if @db.fjmap[@db.dbname]
        @run_batch_flatjson flatBatchExecutesEntries, waiting, handlerFor
      else
        @run_batch1 flatBatchExecutesEntries, waiting, handlerFor

      return

    # version with flat JSON interface
    SQLitePluginTransaction::run_batch_flatjson = (flatBatchExecutesEntries, count, handlerFor) ->
      # XXX TBD evidently not always set in SQLitePlugin::open
      # FUTURE TBD more elegant solution that may possibly be more efficient
      @db.dbid = @db.dbidmap[@db.dbname]

      batchExecutesLength = flatBatchExecutesEntries.length

      mycb = (result) ->
        i = 0
        ri = 0
        rl = result.length

        if rl > 0 and result[0] is 'batcherror'
          while i < batchExecutesLength
            # XXX TODO use correct error code values
            handlerFor(i, false)
              result:
                code: -1
                sqliteCode: -1
                message: 'internal batch error'
            ++i

          return

        while ri < rl
          r = result[ri++]

          if r == 'ok'
            handlerFor(i, true)({ rows: [] })

          else if r is "ch2"
            changes = result[ri++]
            insert_id = result[ri++]

            handlerFor(i, true)({
              rowsAffected: changes
              insertId: insert_id
            })

          else if r == 'okrows'
            rows = []
            changes = 0
            insert_id = undefined

            if result[ri] == 'changes'
              ++ri
              changes = result[ri++]

            if result[ri] == 'insert_id'
              ++ri
              insert_id = result[ri++]

            while result[ri] != 'endrows'
              c = result[ri++]
              j = 0
              row = {}

              while j < c
                k = result[ri++]
                v = result[ri++]
                row[k] = v
                ++j

              rows.push row

            handlerFor(i, true)({
              rows: rows
              rowsAffected: changes
              insertId: insert_id
            })

            ++ri

          else if r == 'error'
            code = result[ri++]
            ++ri # [ignored]
            errormessage = result[ri++]

            handlerFor(i, false)({
              code: code
              message: errormessage
            })

          ++i

        return

      if @db.dbid is -1
        @run_batch_flat_with_dbname flatBatchExecutesEntries, count, mycb
      else
        @run_batch_flat_with_dbid_part1 flatBatchExecutesEntries, mycb

      return

    SQLitePluginTransaction::run_batch_flat_with_dbname = (flatBatchExecutesEntries, count, mycb) ->
      batchExecutesLength = flatBatchExecutesEntries.length

      flatlist = [@db.dbid, batchExecutesLength]

      # Use Array.prototype.concat since Array.prototype.push should not be applied on
      # applied on large number of elements ref:
      # https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/push#Merging_two_arrays
      for e in flatBatchExecutesEntries
        flatlist = flatlist.concat e

      flatlist.push 'extra'

      cordova.exec mycb, null, "SQLitePlugin", "fj",
        [{dbargs: {dbname: @db.dbname}, flen: count, flatlist: flatlist}]

      return

    SQLitePluginTransaction::run_batch_flat_with_dbid_part1 = (flatBatchExecutesEntries, mycb) ->
      check1 = false
      rrr = []

      mycb2 = (result) ->
        if result.length is 0
          # TBD just in case:
          return mycb(rrr)
        else if result[0] is "multi"
          check1 = true
        else if result[0] is null
          if check1
            return mycb(rrr)
        else
          if check1
            rrr = rrr.concat(result)
          else
            # NOT EXPECTED HERE
            return
        return

      @run_batch_flat_with_dbid_part2 flatBatchExecutesEntries, mycb2

      return

    SQLitePluginTransaction::run_batch_flat_with_dbid_part2 = (flatBatchExecutesEntries, cb) ->
      cb(['multi'])

      batchExecutesLength = flatBatchExecutesEntries.length

      mydbid = @db.dbid

      resultSet = []

      partial = (index) ->
        flen = flatBatchExecutesEntries[index].flen

        flatlist = [mydbid, flen]

        flatlist = flatlist.concat flatBatchExecutesEntries[index].map (v) ->
          if typeof v == 'string'
            v.replace(REPLACE_BANG_REGEXP, '!1').replace(REPLACE_SLASH_REGEXP, '!2')
          else
            v

        flatlist.push 'extra'

        ch1 = false
        cb1 = (result) ->
          if result[0] is 'multi'
            ch1 = true
          else if result[0] isnt null
            resultSet = resultSet.concat result.slice(0, result.length-1)
            if !ch1
              cb1 [null]
          else # if result[0] is null
            if (index + 1 == batchExecutesLength)
              cb resultSet
              cb [null]
            else
              partial index + 1
          return

        # NOTE: flatlist.length is needed internally for the JSON decoding.
        cordova.exec cb1, null, "SQLitePlugin", "fj:#{flatlist.length};extra", flatlist

        return

      partial 0

      return

    # version for platforms with no flat JSON interface:
    SQLitePluginTransaction::run_batch1 = (flatBatchExecutesEntries, count, handlerFor) ->
      flatlist = []

      for e in flatBatchExecutesEntries
        flatlist = flatlist.concat e

      tropts = []
      mycbmap = {}

      fi = 0
      i = 0
      while i < count
        sql = flatlist[fi++]
        paramsCount = flatlist[fi++]
        fi2 = fi+paramsCount
        params = flatlist.slice(fi, fi2)
        fi = fi2

        mycbmap[i] =
          success: handlerFor(i, true)
          error: handlerFor(i, false)

        tropts.push
          sql: sql
          params: params

        i++

      mycb = (result) ->
        #console.log "mycb result #{JSON.stringify result}"

        for resultIndex in [0 .. result.length-1]
          r = result[resultIndex]
          type = r.type
          res = r.result

          q = mycbmap[resultIndex]

          if q
            if q[type]
              q[type] res

          ++i

        return

      cordova.exec mycb, null, "SQLitePlugin", "backgroundExecuteSqlBatch", [{dbargs: {dbname: @db.dbname}, executes: tropts}]

      return

    SQLitePluginTransaction::$abort = (txFailure) ->
      if @finalized then return
      tx = @

      succeeded = (tx) ->
        txLocks[tx.db.dbname].inProgress = false
        tx.db.startNextTransaction()
        if tx.error and typeof tx.error is 'function'
          tx.error txFailure
        return

      failed = (tx, err) ->
        txLocks[tx.db.dbname].inProgress = false
        tx.db.startNextTransaction()
        if tx.error and typeof tx.error is 'function'
          tx.error newSQLError 'error while trying to roll back: ' + err.message, err.code
        return

      @finalized = true

      if @txlock
        @addStatement "ROLLBACK", [], succeeded, failed
        @run()
      else
        succeeded(tx)

      return

    SQLitePluginTransaction::$finish = ->
      if @finalized then return
      tx = @

      succeeded = (tx) ->
        txLocks[tx.db.dbname].inProgress = false
        tx.db.startNextTransaction()
        if tx.success and typeof tx.success is 'function'
          tx.success()
        return

      failed = (tx, err) ->
        txLocks[tx.db.dbname].inProgress = false
        tx.db.startNextTransaction()
        if tx.error and typeof tx.error is 'function'
          tx.error newSQLError 'error while trying to commit: ' + err.message, err.code
        return

      @finalized = true

      if @txlock
        @addStatement "COMMIT", [], succeeded, failed
        @run()
      else
        succeeded(tx)

      return

    SQLitePluginTransaction::abortFromQ = (sqlerror) ->
      # NOTE: since the transaction is waiting in the queue,
      # the transaction function containing the SQL statements
      # would not be run yet. Simply report the transaction error.
      if @error
        @error sqlerror

      return

## SQLite plugin object factory:

    # OLD:
    dblocations = [ "docs", "libs", "nosync" ]

    iosLocationMap =
      'default' : 'nosync'
      'Documents' : 'docs'
      'Library' : 'libs'

    SQLiteFactory =
      ###
      NOTE: this function should NOT be translated from Javascript
      back to CoffeeScript by js2coffee.
      If this function is edited in Javascript then someone will
      have to translate it back to CoffeeScript by hand.
      ###
      openDatabase: argsArray (args) ->
        if args.length < 1 || !args[0]
          throw newSQLError 'Sorry missing mandatory open arguments object in openDatabase call'

        #first = args[0]
        #openargs = null
        #okcb = null
        #errorcb = null

        #if first.constructor == String
        #  openargs = {name: first}

        #  if args.length >= 5
        #    okcb = args[4]
        #    if args.length > 5 then errorcb = args[5]

        #else
        #  openargs = first

        #  if args.length >= 2
        #    okcb = args[1]
        #    if args.length > 2 then errorcb = args[2]

        if args[0].constructor == String
          throw newSQLError 'Sorry first openDatabase argument must be an object'

        openargs = args[0]

        # check here
        if !openargs.name
          throw newSQLError 'Database name value is missing in openDatabase call'

        if !openargs.iosDatabaseLocation and !openargs.location and openargs.location isnt 0 and !openargs.androidDatabaseLocation
          throw newSQLError 'Database location (or iosDatabaseLocation or androidDatabaseLocation) setting is now mandatory in openDatabase call.'

        if !!openargs.location and !!openargs.iosDatabaseLocation
          throw newSQLError 'AMBIGUOUS: both location and iosDatabaseLocation settings are present in openDatabase call. Please use either setting, not both.'

        if !!openargs.location and !!openargs.androidDatabaseLocation
          throw newSQLError 'AMBIGUOUS: both location and androidDatabaseLocation settings are present in openDatabase call. Please use either setting, not both. But you *can* use androidDatabaseLocation and iosDatabaseLocation together.'

        dblocation =
          if !!openargs.location and openargs.location is 'default'
            iosLocationMap['default']
          else if !!openargs.iosDatabaseLocation
            iosLocationMap[openargs.iosDatabaseLocation]
          else if !openargs.location and openargs.location isnt 0
            iosLocationMap['default']
          else
            dblocations[openargs.location]

        if !dblocation
          throw newSQLError 'Valid iOS database location could not be determined in openDatabase call'

        openargs.dblocation = dblocation

        if !!openargs.createFromLocation and openargs.createFromLocation == 1
          openargs.createFromResource = "1"

        if !!openargs.androidDatabaseProvider and !!openargs.androidDatabaseImplementation
          throw newSQLError 'AMBIGUOUS: both androidDatabaseProvider and deprecated androidDatabaseImplementation settings are present in openDatabase call. Please drop androidDatabaseImplementation in favor of androidDatabaseProvider.'

        if openargs.androidDatabaseProvider isnt undefined and
            openargs.androidDatabaseProvider isnt 'default' and
            openargs.androidDatabaseProvider isnt 'system'
          throw newSQLError "Incorrect androidDatabaseProvider value. Valid values are: 'default', 'system'"

        if !!openargs.androidDatabaseProvider and openargs.androidDatabaseProvider is 'system'
          openargs.androidOldDatabaseImplementation = 1

        # DEPRECATED:
        if !!openargs.androidDatabaseImplementation and openargs.androidDatabaseImplementation == 2
          openargs.androidOldDatabaseImplementation = 1

        if !!openargs.androidLockWorkaround and openargs.androidLockWorkaround == 1
          openargs.androidBugWorkaround = 1

        okcb = null
        errorcb = null
        if args.length >= 2
          okcb = args[1]
          if args.length > 2 then errorcb = args[2]

        new SQLitePlugin openargs, okcb, errorcb

      deleteDatabase: (first, success, error) ->
        # XXX TODO BUG litehelpers/Cordova-sqlite-storage#367:
        # abort all pending transactions (with error callback)
        # when deleting a database
        # (and cleanup any other internal resources)
        # NOTE: This should properly close the database
        # (at least on the JavaScript side) before deleting.
        args = {}

        if first.constructor == String
          #console.log "delete db name: #{first}"
          #args.path = first
          #args.dblocation = dblocations[0]
          #args.dblocation = dblocations[2]
          throw newSQLError 'Sorry first deleteDatabase argument must be an object'

        else
          #console.log "delete db args: #{JSON.stringify first}"
          if !(first and first['name']) then throw new Error "Please specify db name"
          dbname = first.name

          if typeof dbname != 'string'
            throw newSQLError 'delete database name must be a string'

          args.path = dbname
          #dblocation = if !!first.location then dblocations[first.location] else null
          #args.dblocation = dblocation || dblocations[0]
          #args.dblocation = dblocation || dblocations[2]

        if !first.iosDatabaseLocation and !first.location and first.location isnt 0 and !first.androidDatabaseLocation
          throw newSQLError 'Database location (or iosDatabaseLocation or androidDatabaseLocation) setting is now mandatory in deleteDatabase call.'

        if !!first.location and !!first.iosDatabaseLocation
          throw newSQLError 'AMBIGUOUS: both location and iosDatabaseLocation settings are present in deleteDatabase call. Please use either setting value, not both.'

        if !!first.location and !!first.androidDatabaseLocation
          throw newSQLError 'AMBIGUOUS: both location and androidDatabaseLocation settings are present in deleteDatabase call. Please use either setting, not both. But you *can* use androidDatabaseLocation and iosDatabaseLocation together.'

        dblocation =
          if !!first.location and first.location is 'default'
            iosLocationMap['default']
          else if !!first.iosDatabaseLocation
            iosLocationMap[first.iosDatabaseLocation]
          else if !first.location and first.location isnt 0
            iosLocationMap['default']
          else
            dblocations[first.location]

        if !dblocation
          throw newSQLError 'Valid iOS database location could not be determined in deleteDatabase call'

        args.dblocation = dblocation
        if !!first.androidDatabaseLocation
          args.androidDatabaseLocation = first.androidDatabaseLocation

        # XXX TODO BUG litehelpers/Cordova-sqlite-storage#367 (repeated here):
        # abort all pending transactions (with error callback)
        # when deleting a database
        # (and cleanup any other internal resources)
        delete SQLitePlugin::openDBs[args.path]
        delete SQLitePlugin::dbidmap[args.path]
        delete SQLitePlugin::fjmap[args.path]

        cordova.exec success, error, "SQLitePlugin", "delete", [ args ]

## Self test:

    SelfTest =
      DBNAME: '___$$$___litehelpers___$$$___test___$$$___.db'

      start: (successcb, errorcb) ->
        SQLiteFactory.deleteDatabase {name: SelfTest.DBNAME, location: 'default'},
          (-> SelfTest.step1(successcb, errorcb)),
          (-> SelfTest.step1(successcb, errorcb))
        return

      step1: (successcb, errorcb) ->
        SQLiteFactory.openDatabase {name: SelfTest.DBNAME, location: 'default'}, (db) ->
          check1 = false
          db.transaction (tx) ->
            tx.executeSql 'SELECT UPPER("Test") AS upperText', [], (ignored, resutSet) ->
              if !resutSet.rows
                return SelfTest.finishWithError errorcb, 'Missing resutSet.rows'

              if !resutSet.rows.length
                return SelfTest.finishWithError errorcb, 'Missing resutSet.rows.length'

              if resutSet.rows.length isnt 1
                return SelfTest.finishWithError errorcb,
                  "Incorrect resutSet.rows.length value: #{resutSet.rows.length} (expected: 1)"

              if !resutSet.rows.item(0).upperText
                return SelfTest.finishWithError errorcb,
                  'Missing resutSet.rows.item(0).upperText'

              if resutSet.rows.item(0).upperText isnt 'TEST'
                return SelfTest.finishWithError errorcb,
                  "Incorrect resutSet.rows.item(0).upperText value: #{resutSet.rows.item(0).upperText} (expected: 'TEST')"

              check1 = true
              return

            , (ignored, tx_sql_err) ->
              return SelfTest.finishWithError errorcb, "TX SQL error: #{tx_sql_err}"

            return

          , (tx_err) ->
            return SelfTest.finishWithError errorcb, "TRANSACTION error: #{tx_err}"

          , () ->
            # tx success:
            if !check1
              return SelfTest.finishWithError errorcb,
                'Did not get expected upperText result data'

            # SIMULATE SCENARIO IN BUG litehelpers/Cordova-sqlite-storage#666:
            db.executeSql 'BEGIN', null, (ignored) -> nextTick -> # (nextTick needed for Windows)
              # DELETE INTERNAL STATE to simulate the effects of location refresh or change:
              delete db.openDBs[SelfTest.DBNAME]
              delete txLocks[SelfTest.DBNAME]
              nextTick ->
                # VERIFY INTERNAL STATE IS DELETED:
                db.transaction (tx2) ->
                  tx2.executeSql 'SELECT 1'
                  return
                , (tx_err) ->
                  # EXPECTED RESULT:
                  if !tx_err
                    return SelfTest.finishWithError errorcb, 'Missing error object'
                  SelfTest.step2 successcb, errorcb
                  return
                , () ->
                  # NOT EXPECTED:
                  return SelfTest.finishWithError errorcb, 'Missing error object'
                return
              return

            return
          return

        , (open_err) ->
          SelfTest.finishWithError errorcb, "Open database error: #{open_err}"
        return

      step2: (successcb, errorcb) ->
        SQLiteFactory.openDatabase {name: SelfTest.DBNAME, location: 'default'}, (db) ->
          # TX SHOULD SUCCEED to demonstrate solution to BUG litehelpers/Cordova-sqlite-storage#666:
          db.transaction (tx) ->
            tx.executeSql 'SELECT ? AS myResult', [null], (ignored, resutSet) ->
              if !resutSet.rows
                return SelfTest.finishWithError errorcb, 'Missing resutSet.rows'
              if !resutSet.rows.length
                return SelfTest.finishWithError errorcb, 'Missing resutSet.rows.length'
              if resutSet.rows.length isnt 1
                return SelfTest.finishWithError errorcb,
                  "Incorrect resutSet.rows.length value: #{resutSet.rows.length} (expected: 1)"
              SelfTest.step3 successcb, errorcb
              return
            return
          , (txError) ->
            # NOT EXPECTED:
            return SelfTest.finishWithError errorcb, "UNEXPECTED TRANSACTION ERROR: #{txError}"
          return
        , (open_err) ->
          SelfTest.finishWithError errorcb, "Open database error: #{open_err}"
        return

      step3: (successcb, errorcb) ->
        SQLiteFactory.openDatabase {name: SelfTest.DBNAME, location: 'default'}, (db) ->
          db.sqlBatch [
            'CREATE TABLE TestTable(id integer primary key autoincrement unique, data);'
            [ 'INSERT INTO TestTable (data) VALUES (?);', ['test-value'] ]
          ], () ->
            firstid = -1 # invalid

            db.executeSql 'SELECT id, data FROM TestTable', [], (resutSet) ->
              if !resutSet.rows
                SelfTest.finishWithError errorcb, 'Missing resutSet.rows'
                return

              if !resutSet.rows.length
                SelfTest.finishWithError errorcb, 'Missing resutSet.rows.length'
                return

              if resutSet.rows.length isnt 1
                SelfTest.finishWithError errorcb,
                  "Incorrect resutSet.rows.length value: #{resutSet.rows.length} (expected: 1)"
                return

              if resutSet.rows.item(0).id is undefined
                SelfTest.finishWithError errorcb,
                  'Missing resutSet.rows.item(0).id'
                return

              firstid = resutSet.rows.item(0).id

              if !resutSet.rows.item(0).data
                SelfTest.finishWithError errorcb,
                  'Missing resutSet.rows.item(0).data'
                return

              if resutSet.rows.item(0).data isnt 'test-value'
                SelfTest.finishWithError errorcb,
                  "Incorrect resutSet.rows.item(0).data value: #{resutSet.rows.item(0).data} (expected: 'test-value')"
                return

              db.transaction (tx) ->
                tx.executeSql 'UPDATE TestTable SET data = ?', ['new-value']
              , (tx_err) ->
                SelfTest.finishWithError errorcb, "UPDATE transaction error: #{tx_err}"
              , () ->
                readTransactionFinished = false
                db.readTransaction (tx2) ->
                  tx2.executeSql 'SELECT id, data FROM TestTable', [], (ignored, resutSet2) ->
                    if !resutSet2.rows
                      throw newSQLError 'Missing resutSet2.rows'

                    if !resutSet2.rows.length
                      throw newSQLError 'Missing resutSet2.rows.length'

                    if resutSet2.rows.length isnt 1
                      throw newSQLError "Incorrect resutSet2.rows.length value: #{resutSet2.rows.length} (expected: 1)"

                    if !resutSet2.rows.item(0).id
                      throw newSQLError 'Missing resutSet2.rows.item(0).id'

                    if resutSet2.rows.item(0).id isnt firstid
                      throw newSQLError "resutSet2.rows.item(0).id value #{resutSet2.rows.item(0).id} does not match previous primary key id value (#{firstid})"

                    if !resutSet2.rows.item(0).data
                      throw newSQLError 'Missing resutSet2.rows.item(0).data'

                    if resutSet2.rows.item(0).data isnt 'new-value'
                      throw newSQLError "Incorrect resutSet2.rows.item(0).data value: #{resutSet2.rows.item(0).data} (expected: 'test-value')"
                    readTransactionFinished = true

                , (tx2_err) ->
                  SelfTest.finishWithError errorcb, "readTransaction error: #{tx2_err}"

                , () ->
                  if !readTransactionFinished
                    SelfTest.finishWithError errorcb, 'readTransaction did not finish'
                    return

                  db.transaction (tx3) ->
                    tx3.executeSql 'DELETE FROM TestTable'
                    tx3.executeSql 'INSERT INTO TestTable (data) VALUES(?)', [123]
                  , (tx3_err) ->
                    SelfTest.finishWithError errorcb, "DELETE transaction error: #{tx3_err}"
                  , () ->
                    secondReadTransactionFinished = false
                    db.readTransaction (tx4) ->
                      tx4.executeSql 'SELECT id, data FROM TestTable', [], (ignored, resutSet3) ->
                        if !resutSet3.rows
                          throw newSQLError 'Missing resutSet3.rows'

                        if !resutSet3.rows.length
                          throw newSQLError 'Missing resutSet3.rows.length'

                        if resutSet3.rows.length isnt 1
                          throw newSQLError "Incorrect resutSet3.rows.length value: #{resutSet3.rows.length} (expected: 1)"

                        if !resutSet3.rows.item(0).id
                          throw newSQLError 'Missing resutSet3.rows.item(0).id'

                        if resutSet3.rows.item(0).id is firstid
                          throw newSQLError "resutSet3.rows.item(0).id value #{resutSet3.rows.item(0).id} incorrectly matches previous unique key id value value (#{firstid})"

                        if !resutSet3.rows.item(0).data
                          throw newSQLError 'Missing resutSet3.rows.item(0).data'

                        if resutSet3.rows.item(0).data isnt 123
                          throw newSQLError "Incorrect resutSet3.rows.item(0).data value: #{resutSet3.rows.item(0).data} (expected 123)"

                        secondReadTransactionFinished = true

                    , (tx4_err) ->
                      SelfTest.finishWithError errorcb, "second readTransaction error: #{tx4_err}"
                    , () ->
                      if !secondReadTransactionFinished
                        SelfTest.finishWithError errorcb, 'second readTransaction did not finish'
                        return

                      # CLEANUP & FINISH:
                      db.close () ->
                        SelfTest.cleanupAndFinish successcb, errorcb
                        return

                      , (close_err) ->
                        # DO NOT IGNORE CLOSE ERROR ON ANY PLATFORM:
                        SelfTest.finishWithError errorcb, "close error: #{close_err}"
                        return

                      return

            , (select_err) ->
              SelfTest.finishWithError errorcb, "SELECT error: #{select_err}"

          , (batch_err) ->
            SelfTest.finishWithError errorcb, "sql batch error: #{batch_err}"

        , (open_err) ->
          SelfTest.finishWithError errorcb, "Open database error: #{open_err}"
        return

      cleanupAndFinish: (successcb, errorcb) ->
        SQLiteFactory.deleteDatabase {name: SelfTest.DBNAME, location: 'default'}, successcb, (cleanup_err)->
          # DO NOT IGNORE CLEANUP DELETE ERROR ON ANY PLATFORM:
          SelfTest.finishWithError errorcb, "CLEANUP DELETE ERROR: #{cleanup_err}"
          return
        return

      finishWithError: (errorcb, message) ->
        console.log "selfTest ERROR with message: #{message}"
        SQLiteFactory.deleteDatabase {name: SelfTest.DBNAME, location: 'default'}, ->
          errorcb newSQLError message
          return
        , (err2)->
          console.log "selfTest CLEANUP DELETE ERROR #{err2}"
          errorcb newSQLError "CLEANUP DELETE ERROR: #{err2} for error: #{message}"
          return
        return

## Exported API:

    root.sqlitePlugin =
      sqliteFeatures:
        isSQLitePlugin: true

      echoTest: (okcb, errorcb) ->
        ok = (s) ->
          if s is 'test-string'
            okcb()
          else
            errorcb "Mismatch: got: '#{s}' expected 'test-string'"

        error = (e) ->
          errorcb e

        cordova.exec ok, error, "SQLitePlugin", "echoStringValue", [{value:'test-string'}]

      selfTest: SelfTest.start

      openDatabase: SQLiteFactory.openDatabase
      deleteDatabase: SQLiteFactory.deleteDatabase

## vim directives

#### vim: set filetype=coffee :
#### vim: set expandtab :
