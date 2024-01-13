using System.Data;

namespace ordermateAPI.DAL.Interfaces;

public interface IDbContext
{
    IDbConnection CreateConnection();
}