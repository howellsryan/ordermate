using System.Data;
using System.Data.SqlClient;
using ordermateAPI.DAL.Interfaces;

namespace ordermateAPI.DAL;

public class DbContext : IDbContext
{
    private readonly string _connectionString;
    
    public DbContext(IConfiguration configuration)
    {
        _connectionString = configuration.GetSection("ConnectionString").Value;
    }
    
    public IDbConnection CreateConnection()
        => new SqlConnection(_connectionString);
}